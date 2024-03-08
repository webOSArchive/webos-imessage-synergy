require.paths.push("./node_modules");
var child_process = require('child_process');

//This is where actual implementations of the Synergy functions are done
// The mapping of the Synergy call to these end-points is in services.json

var checkCredentialsAssistant = function(future) {};
checkCredentialsAssistant.prototype.run = function(future) {  

     var args = this.controller.args;
     logNoticeably("checkCredentials args =" + JSON.stringify(args));

     //Delete our account username/password from key store
     PalmCall.call("palm://com.palm.keymanager/", "remove", {"keyname" : "AcctUsername"}).then( function(f2) 
     {
         logNoticeably("Deleted old username");
         PalmCall.call("palm://com.palm.keymanager/", "remove", {"keyname" : "AcctPassword"}).then( function(f3) 
         {
            logNoticeably("Deleted old password");
            logNoticeably("Confirming new account");
            future.result = {returnValue: true, "credentials": {"common":{ "password" : args.password, "username":args.username}},
                                             "config": { "password" : args.password, "username":args.username} };
         });
     });
};

var onCapabilitiesChangedAssistant = function(future){};
onCapabilitiesChangedAssistant.prototype.run = function(future) { 
   // 
   // Called when an account's capability providers changes. The new state of enabled 
   // capability providers is passed in. This is useful for Synergy services that handle all syncing where 
   // it is easier to do all re-syncing in one step rather than using multiple 'onEnabled' handlers.
   //
   var args = this.controller.args; 
   logNoticeably("onCapabilitiesChanged args =" + JSON.stringify(args));   
   future.result = {returnValue: true};
};

var onCredentialsChangedAssistant = function(future){};
onCredentialsChangedAssistant.prototype.run = function(future) { 
// Called when the user has entered new, valid credentials to replace existing invalid credentials. 
// This is the time to start syncing if you have been holding off due to bad credentials.
   var args = this.controller.args; 
   logNoticeably("onCredentialsChanged args =" + JSON.stringify(args));
   future.result = {returnValue: true};
};

var onCreateAssistant = function(future){};
onCreateAssistant.prototype.run = function(future) {  
// The account has been created. Time to save the credentials contained in the "config" object
// that was emitted from the "checkCredentials" function.
   var args = this.controller.args;
   logNoticeably("onCreateAssistant args =" + JSON.stringify(args));

   //Username/password passed in "config" object
   var B64username = Base64.encode(args.config.username);
   var B64password = Base64.encode(args.config.password);

   var keystore1 = { "keyname":"AcctUsername", "keydata": B64username, "type": "AES", "nohide":true};
   var keystore2 = { "keyname":"AcctPassword", "keydata": B64password, "type": "AES", "nohide":true};

   //Save encrypted username/password for syncing.
   PalmCall.call("palm://com.palm.keymanager/", "store", keystore1).then( function(f) 
   {
      if (f.result.returnValue === true)
      {
         logNoticeably("Saved new username");
         PalmCall.call("palm://com.palm.keymanager/", "store", keystore2).then( function(f2) 
         {
            logNoticeably("Saved new password");
            future.result = f2.result;
         });
      }
      else   {
         future.result = f.result;
      }
   });
};

var onEnabledAssistant = function(future){};
onEnabledAssistant.prototype.run = function(future) {  
// Synergy service got 'onEnabled' message. When enabled, a sync should be started and future syncs scheduled.
// Otherwise, syncing should be disabled and associated data deleted.
// Account-wide configuration should remain and only be deleted when onDelete is called.

   var args = this.controller.args;
   logNoticeably("onEnabledAssistant args =" + JSON.stringify(args));
   future.result = {returnValue: true};
   if (args.enabled === true)   //The Accounts UI won't have the option to disable, since we only provide a single service
   {
      PalmCall.call("palm://com.wosa.imessage.service/", "sync", {}).then( function(future) 
      { 
         future.result = future.result;
      });
   }
};

var syncAssistant = function(future){};
syncAssistant.prototype.run = function(future) { 
// Synergy service got 'sync' request. A sync should be started and future syncs scheduled.

   var args = this.controller.args;
   logNoticeably("syncAssistant running with ARGS =" + JSON.stringify(args));
   var username = "";
   var password = "";
   var syncServer = "";
   var syncPort = 8080;
   var historyLimit = 10;
   var syncInterval = "2m";
   var transportConfigId;
   var storedChatThreads = [];
   var remoteChatThreads = [];

   //Retrieve config from db8
   var q = {"query":{"from":"com.wosa.imessage.transport:1"}};
   var f = PalmCall.call("palm://com.palm.db/", "find", q).then(function(future) {
      if (future.result.returnValue === true)
      {
         var lastSyncDateTime = calcSyncDateTime();
         // Log sync attempt time
         if(future.result && future.result.results && Array.isArray(future.result.results) && future.result.results.length > 0 && future.result.results[0]._id) {
            //Update existing config record
            transportConfigId = future.result.results[0]._id;
            var syncRec = {"_id":transportConfigId, "lastSync":lastSyncDateTime };
            DB.merge([syncRec]).then(function(logSync) {
               if (logSync.result.returnValue === true)
                  logNoticeably("Logged sync time to existing record in DB8\n");
               else 
                  logNoticeably("FAILED TO LOG sync time to existing record in DB8\n");
            })
         } else {
            //Create config record
            var syncRec = [{ _kind: "com.wosa.imessage.transport:1", "lastSync":lastSyncDateTime}];
            DB.put(syncRec).then(function(logSync) {
               if (logSync.result.returnValue === true)
                  logNoticeably("Logged sync time as new record in DB8\n");
               else 
                  logNoticeably("FAILED TO LOG sync time as new record in DB8\n");
            });
         }
         // Find server info
         if (future.result.results && Array.isArray(future.result.results) && future.result.results.length > 0 && future.result.results[0].messageBridgeServer && future.result.results[0].messageBridgeServer != "") {
            syncServer = future.result.results[0].messageBridgeServer;
            syncPort = future.result.results[0].messageBridgePort;
            if (future.result.results[0].syncInterval)
               syncInterval = future.result.results[0].syncInterval;
            //Next (in the "future") we'll retrieve our saved username
            return PalmCall.call("palm://com.palm.keymanager/", "fetchKey", {"keyname" : "AcctUsername"});
         } else {
            logNoticeably("could not find message bridge server in DB8\n");
            //Notify user via app...
            PalmCall.call("palm://com.palm.applicationManager/", "open", {"id": "com.wosa.imessage", "params":{"status":"syncConfigMissing"}});
            future.result = {returnValue: false};
         }
      }
      else {
         logNoticeably("could not find message bridge configuration in DB8\n");
         //Notify user via app...
         PalmCall.call("palm://com.palm.applicationManager/", "open", {"id": "com.wosa.imessage", "params":{"status":"syncConfigMissing"}});
         future.result = {returnValue: false};
      }
   });
   
   //Retrieve our saved username from db8
   f.then(this, function (future) {
      if (future.result.returnValue === true)  //got the username
      {
         username = Base64.decode(f.result.keydata);
         //Next (in the "future") we'll retreive the password
         return PalmCall.call("palm://com.palm.keymanager/", "fetchKey", {"keyname" : "AcctPassword"});
      }
      else {
         logNoticeably("could not find account username in DB8\n");
         future.result = future.result;  // Failure to get account username from Key Manager
      }
   });

   //Retrieve our saved password from db8
   f.then(this, function(future) {
      if (future.result.returnValue === true) //got the password
      {
         //Format Basic authentication
         password = Base64.decode(f.result.keydata);
         var base64Auth = "Basic " + Base64.encode(username + ":" + password);
         if (syncServer.indexOf("http:") != -1) {  //fix old style
            syncServer = syncServer.replace("http://", "");
            syncServer = syncServer.replace("/chats", "");
            var syncURLParts = syncServer.split(":");
            syncServer = syncURLParts[0];
            syncPort = syncURLParts[1];
         }
         
         if (syncServer != "") {
            logNoticeably("syncServer="+syncServer +"\n");
            logNoticeably("syncPort="+syncPort +"\n");
            logNoticeably("sync credentials="+username + " - " + password +"\n");
   
            //Next (in the "future") we'll get our saved chatthreads
            var q = {"from":"com.wosa.imessage.chatthread:1"};
            return DB.find(q, false, false)   
         } else {
            logNoticeably("The Sync Server was not defined, so sync cannot proceed");
            future.result = {returnValue: false};
         }
      } else {
         logNoticeably("could not find account password in DB8\n");
         future.result = future.result;  // Failure to get account pwd from Key Manager
      }
   });

   //Retreive our saved chat threads from db8
   f.then(this, function(future) {
      if (future.result.results.length > 0) {
         storedChatThreads = future.result.results;
      }

      logNoticeably("1. THERE ARE " + storedChatThreads.length + " STORED CHAT THREADS");
      //Sync messages for any stored chat threads
      for (var i=0;i<storedChatThreads.length;i++) {
         logNoticeably(" **** STORED: " + JSON.stringify(storedChatThreads[i]));
         logNoticeably(" **** ARGS: " + JSON.stringify({conversationId: storedChatThreads[i]._id, iMessageId: storedChatThreads[i].iMessageId, replyId: storedChatThreads[i].iMessageReplyId}));
         PalmCall.call("palm://com.wosa.imessage.service/", "syncChat", {conversationId: storedChatThreads[i]._id, iMessageId: storedChatThreads[i].iMessageId, replyId: storedChatThreads[i].iMessageReplyId});
      }
      
      //Next (in the "future") we'll get remote chat threads
      var chatsQuery = {
         host: syncServer,
         port: syncPort,
         path: "/chats?limit=" + historyLimit,
         method: "GET",
         binary: false
      }
      logNoticeably("Performing chats httpRequest call with query " + JSON.stringify(chatsQuery));
      return PalmCall.call("palm://com.wosa.imessage.service", "httpRequest", chatsQuery);
   });

   //Retreive our remote chat threads from service
   f.then(this, function(future) {

      logNoticeably("In chat httpRequests future callback!");
      if (future.result.returnValue) {
         logNoticeably("got httpRequests result: " + JSON.stringify(future.result.data));
         remoteChatThreads = JSON.parse(future.result.data);

         //Store any chat threads we didn't already know about
         var createdChatThread = false;
         for (var i=0;i<remoteChatThreads.length;i++) {

            var thisThread = remoteChatThreads[i];
            var foundStoredChat = false;
            for (var c=0;c<storedChatThreads.length;c++) {
               var thisChat = storedChatThreads[c];
               if (thisChat.iMessageId && thisThread.id == thisChat.iMessageId) {
                  foundStoredChat = true;
                  break;
               }
            }
            if (!foundStoredChat) {
               logNoticeably("the remote thread with id " + thisThread.id + " did not exist locally, creating...");
               createdChatThread = true;
               var msgTS = Date.parse(thisThread.lastReceived);
               var replyAddress = thisThread.replyId.split(";-;");
               replyAddincomingress = replyAddress[replyAddress.length-1];
               var dbThread = {
                  _kind: "com.wosa.imessage.chatthread:1",
                  flags:{visible:true},
                  normalizedAddress: username,
                  displayName: thisThread.name,
                  replyAddress: replyAddress,
                  iMessageReplyId: thisThread.replyId,
                  replyService: "iMessage",
                  summary: thisThread.lastMessage,
                  iMessageId: thisThread.id,
                  timestamp: msgTS,
               }
               //This is a fire and forget future call...
               DB.put([dbThread]).then(function(chatput) {
                  logNoticeably("put chat thread for iMessage id: " + thisThread.id + " with initial message: " + JSON.stringify(dbThread));
               });
               createdChatThread = true;
            }
         }
         if (createdChatThread) {
            PalmCall.call("palm://com.wosa.imessage.service/", "sync", {}).then(function(syncResult) {
               logNoticeably("a follow-up sync has been ordered to populate initial messages!");
               future.result = {returnValue: true};
            });
         }
      }
   });

   logNoticeably("ALL DONE SYNCING!");
   logNoticeably("Scheduling next syncs...");
   syncActivity = 
   {
      "start": true,
      "replace": true,
      "activity": {
         "name": "iMessagePeriodicSync",
         "description": "Recreate Periodic Sync of incoming messages from iMessage",
         "type": {
            "background": true,
            "power": true,
            "powerDebounce": true,
            "explicit": true,
            "persist": true
         },
         "requirements": {
            "internet": true
         },
         "schedule": {
            "precise": true,
            "interval": syncInterval
         },
         "callback": {
            "method": "palm://com.wosa.imessage.service/periodicSync",
            "params": {timedSync: true}
         }
      }
   };
   // for some reason, the activity no longer exists by the time we get here, so instead of
   // completing it, we re-create it. i guess.
   logNoticeably("sync interval complete completed, restarting sync interval every " + syncInterval);
   return PalmCall.call("palm://com.palm.activitymanager/", "create", syncActivity).then(function(f) {
      logNoticeably("activity create results=", JSON.stringify(f.result));
      future.result = { returnValue: true };
   }, function(f) {
      logNoticeably("Something bad happened scheduling recurring sync. This is probably fatal!");
      // TODO: trigger the app to display an error to the user ?
      future.result = { returnValue: false };
   });
};

//This syncs message history from individual chat threads
var syncChatAssistant = function(future){};
syncChatAssistant.prototype.run = function(future) {
   var args = this.controller.args;
   if (!args || !args.conversationId || !args.iMessageId || !args.replyId) {
      future.result = {returnValue: false};
   }

   logNoticeably("PERFORMING CHAT HISTORY SYNC FOR " + JSON.stringify(args));

   var username = "";
   var password = "";
   var syncServer = "";
   var syncPort = 8080;
   var conversationId = args.conversationId;
   var iMessageThreadId = args.iMessageId;
   var replyId = args.replyId;
   var historyLimit = 10; //TODO: make global
   var storedMessages = [];

   var q = {"query":{"from":"com.wosa.imessage.transport:1"}};
   var f = PalmCall.call("palm://com.palm.db/", "find", q).then(function(future) {
      if (future.result.returnValue === true)
      {
         // Find server info
         if (future.result.results && Array.isArray(future.result.results) && future.result.results.length > 0 && future.result.results[0].messageBridgeServer && future.result.results[0].messageBridgeServer != "") {
            syncServer = future.result.results[0].messageBridgeServer;
            syncPort = future.result.results[0].messageBridgePort;

            //Next (in the "future") we'll retrieve our saved username
            return PalmCall.call("palm://com.palm.keymanager/", "fetchKey", {"keyname" : "AcctUsername"});
         } else {
            logNoticeably("could not find message bridge server in DB8\n");
            future.result = {returnValue: false};
         }
      }
      else {
         logNoticeably("could not find message bridge configuration in DB8\n");
         future.result = {returnValue: false};
      }
   });
   
   //Retrieve our saved username from db8
   f.then(this, function (future) {
      if (future.result.returnValue === true)  //got the username
      {
         username = Base64.decode(f.result.keydata);
         //Next (in the "future") we'll retreive the password
         return PalmCall.call("palm://com.palm.keymanager/", "fetchKey", {"keyname" : "AcctPassword"});
      }
      else {
         logNoticeably("could not find account username in DB8\n");
         future.result = {returnValue: false};
      }
   });

   //Retrieve our saved password from db8
   f.then(this, function(future) {
      if (future.result.returnValue === true) //got the password
      {
         //Format Basic authentication
         password = Base64.decode(f.result.keydata);
         var base64Auth = "Basic " + Base64.encode(username + ":" + password);
         if (syncServer.indexOf("http:") != -1) {  //fix old style
            syncServer = syncServer.replace("http://", "");
            syncServer = syncServer.replace("/chats", "");
            var syncURLParts = syncServer.split(":");
            syncServer = syncURLParts[0];
            syncPort = syncURLParts[1];
         }
         
         if (syncServer != "") {
            logNoticeably("syncServer="+syncServer +"\n");
            logNoticeably("syncPort="+syncPort +"\n");
            logNoticeably("sync credentials="+username + " - " + password +"\n");
   
            //Next (in the "future") we'll get our saved messages
            var q = {"from":"com.wosa.imessage.immessage:1"};  //TODO: we could specify a tighter query here
            return DB.find(q, false, false); 
         } else {
            logNoticeably("The Sync Server was not defined, so sync cannot proceed");
            future.result = {returnValue: false};
         }
      } else {
         logNoticeably("could not find account password in DB8\n");
         future.result = {returnValue: false};
      }
   });   

   //Retreive our saved messages from db8
   f.then(this, function(future) {
      if (future.result.results.length > 0) {
         storedMessages = future.result.results;
      }

      //Next (in the "future") we'll get remote messages for the specified chat thread
      var historyQuery = {
         host: syncServer,
         port: syncPort,
         path: "/chats/" + iMessageThreadId + "/messages?limit=" + historyLimit,
         method: "GET",
         binary: false
      }
      logNoticeably("Performing history httpRequest call with query " + JSON.stringify(historyQuery));
      return PalmCall.call("palm://com.wosa.imessage.service", "httpRequest", historyQuery);
   });

   f.then(this, function(future) {
      logNoticeably("In history httpRequests future callback!");
      if (future.result.returnValue) {
         logNoticeably("got message history response");
         var body = future.result.data;
         logNoticeably("history httpRequest result body: " + JSON.stringify(future.result));

         imsgDispatches = JSON.parse(body);
         for (var d=0;d<imsgDispatches.length;d++) {
            var thisDispatch=imsgDispatches[d];
            var msgTS = Date.parse(thisDispatch.received);
            logNoticeably("checking if message exists in db: " + JSON.stringify(thisDispatch));
            var foundStoredDispatch = false;
            for (var s=0;s<storedMessages.length;s++) {
               var thisStoredMsg = storedMessages[s];
               if (thisStoredMsg.iDispatchId == thisDispatch.id) {
                  logNoticeably("a dispatch with an identical id " + thisDispatch.id + " was found, not re-creating.")
                  foundStoredDispatch = true;
                  break;
               }
            }
            if (!foundStoredDispatch) {
               logNoticeably("incoming dispatch with id " + thisDispatch.id + " needs to be created for chat " + conversationId);
               var useFolder = "inbox";
               var useFlags = {read:false}
               if (thisDispatch.isMe) {
                  useFolder = "outbox";
                  useFlags = {read:true}
               }
               var dbMsg = {
                  _kind:"com.wosa.imessage.immessage:1",
                  _sync:true,
                  flags: useFlags,
                  folder: useFolder,
                  conversations: [conversationId],
                  localTimestamp: msgTS,
                  messageText: thisDispatch.body,
                  serviceName: "iMessage",
                  status: "successful",
                  from: [{ addr:replyId, name: thisDispatch.from }],
                  to: [{ addr: username, name: username }],
                  username: username,
                  iMessageId: thisDispatch.chatId,
                  iDispatchId: thisDispatch.id,
               }
               logNoticeably("made message dispatch with id " + thisDispatch.id + ": " + JSON.stringify(dbMsg));
               //Put the new message in the database
               DB.put([dbMsg]).then(function(msgput) {
                  if (msgput.result.returnValue === true)
                     logNoticeably("put new dispatch for iMessage Thread id: " + iMessageThreadId);
                  else 
                     logNoticeably("FAILED to put new dispatch for iMessage Thread id: " + iMessageThreadId);
               });
               //Also update the chat thread summary with most recent message
               if (d == 0) {
                  var mergeRec = {"_kind":"com.wosa.imessage.chatthread:1", "_id":conversationId, "summary":thisDispatch.body, "timestamp": msgTS };
                  DB.merge([mergeRec]).then(function(chatmerge) {
                     if (chatmerge.result.returnValue === true)
                        logNoticeably("merged new summary for iMessage id: " + iMessageThreadId + " with db8 id: " + conversationId);
                     else 
                        logNoticeably("failed to merge new summary for iMessage id: " + iMessageThreadId + " with db8 id: " + conversationId);
                  });   
               }
            } else {
               logNoticeably("incoming dispatch with id " + thisDispatch.id + " is already stored");
            }
         }
      }
      future.result = {returnValue: true};
   });
   future.result = {returnValue: true};
}

var periodicSync = function(future){}
periodicSync.prototype.run = function(future) {
   logNoticeably("periodicSync run");
   PalmCall.call("palm://com.wosa.imessage.service/", "sync", {timedSync: true});
   future.result = { returnValue: true };
};
periodicSync.prototype.complete = function() {
   logNoticeably("periodicSync complete!");
}

var onDeleteAssistant = function(future){};
onDeleteAssistant.prototype.run = function(future) { 
// Account deleted - Synergy service should delete account and config information here.

   logNoticeably("onDelete args =" + JSON.stringify(args));
   future.result = {returnValue: true};
   var args = this.controller.args;

   //Cancel activity (fire and forget)
   PalmCall.call("palm://com.palm.activitymanager/", "cancel", { "activityName":"iMessagePeriodicSync" });

   //Clean up transport, then..
   var q = {"query":{"from":"com.wosa.imessage.transport:1"}};
   var f = PalmCall.call("palm://com.palm.db/", "del", q).then(function(future) 
   {
      if (future.result.returnValue !== true)
         logNoticeably("an error occured cleaning up iMessage Bridge sync info");
      else
         logNoticeably("deleted iMessage Bridge sync info");
      q ={ "query":{ "from":"com.wosa.imessage.immessage:1" }};
      return PalmCall.call("palm://com.palm.db/", "del", q);
   });

   //Clean up messages, then...
   f.then(this, function (future) {
      if (future.result.returnValue !== true)
         logNoticeably("an error occured cleaning up messages");
      else
         logNoticeably("cleaned up messages");
      q ={ "query":{ "from":"com.wosa.imessage.chatthread:1" }};
      return PalmCall.call("palm://com.palm.db/", "del", q);
   });

   //Clean up chat threads, then...
   f.then(this, function (future) {
      if (future.result.returnValue !== true)
         logNoticeably("an error occured cleaning up chat threads");
      else
         logNoticeably("cleaned up chat threads");
      return PalmCall.call("palm://com.palm.keymanager/", "remove", {"keyname" : "AcctUsername"});
   });

   //Clean up username, then...
   f.then(this, function (future) {
      if (future.result.returnValue !== true)
         logNoticeably("an error occured removing iMessage Username");
      else
         logNoticeably("removed iMessage Username");
      return PalmCall.call("palm://com.palm.keymanager/", "remove", {"keyname" : "AcctPassword"}); 
   });

   //Clean up password, then...
   f.then(this, function (future) {
      if (future.result.returnValue !== true)
         logNoticeably("an error occured removing iMessage Password");
      else
         logNoticeably("removed iMessage Password");
      future.result = {returnValue: true};
   });
};

var httpRequestAssistant = function(future){};
httpRequestAssistant.prototype.run = function(future) {
   var args = this.controller.args;

   console.log("Making http call using wget ");
   var host = args.host || "imessageserver";
   var port = args.port || "8080";
   var path = args.path || "/";
   
   var url = "http://" + host + ":" + port + path;
   var cmd = "wget -q -O -";
   
   cmd += " " + url;
   console.log("Child Process command: " + cmd);
   var child = child_process.exec(cmd, function(error, stdout, stderr) {
      future.result = { returnValue: error == null, data: stdout, file: args.savefile };
   });
   return;
}

//TODO...

var sendIM = function(future){};
sendIM.prototype.run = function(future) { 
   logNoticeably("sendIM args =" + JSON.stringify(args));
   future.result = {returnValue: true};
}