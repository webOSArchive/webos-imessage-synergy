require.paths.push("./node_modules");
var child_process = require('child_process');
var http = require('http');

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
      if (!future.result.returnValue) {
         return;
      }
      if (future.result.results && future.result.results.length > 0) {
         storedChatThreads = future.result.results;
      }

      logNoticeably("1. THERE ARE " + storedChatThreads.length + " STORED CHAT THREADS");
      // syncChat calls are now deferred until we compare against remote lastReceived timestamps.
      // Only threads with changed content will be synced — see remote thread loop below.

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

         // For each remote thread, find its local counterpart and do a delta check.
         // Only call syncChat when lastReceived has changed (new message) or the thread is new.
         // This avoids hammering the bridge with per-thread requests when nothing has changed.
         for (var i=0;i<remoteChatThreads.length;i++) {

            var thisThread = remoteChatThreads[i];
            var matchedChat = null;
            for (var c=0;c<storedChatThreads.length;c++) {
               var thisChat = storedChatThreads[c];
               if (thisChat.iMessageId && thisThread.id == thisChat.iMessageId) {
                  matchedChat = thisChat;
                  break;
               }
            }

            if (matchedChat) {
               // Thread is known locally — only fetch messages if the bridge reports new content.
               // iMessageLastReceived is the ISO timestamp stored from the previous sync cycle.
               (function(thread, storedChat) {
                  if (storedChat.iMessageLastReceived !== thread.lastReceived) {
                     logNoticeably("thread " + thread.id + " changed (remote=" + thread.lastReceived + " stored=" + storedChat.iMessageLastReceived + "), syncing");
                     PalmCall.call("palm://com.wosa.imessage.service/", "syncChat", {
                        conversationId: storedChat._id,
                        iMessageId: storedChat.iMessageId,
                        replyId: storedChat.iMessageReplyId
                     });
                     DB.merge([{_kind:"com.wosa.imessage.chatthread:1", "_id":storedChat._id, "iMessageLastReceived": thread.lastReceived}]).then(function(r) {
                        logNoticeably("updated iMessageLastReceived for thread " + thread.id + ": " + JSON.stringify(r.result));
                     });
                  } else {
                     logNoticeably("thread " + thread.id + " unchanged (lastReceived=" + thread.lastReceived + "), skipping syncChat");
                  }
               })(thisThread, matchedChat);
            } else {
               logNoticeably("the remote thread with id " + thisThread.id + " did not exist locally, creating...");
               // IIFE captures thisThread by value so the async DB.put callback sees the right thread
               (function(thread) {
                  var msgTS = Date.parse(thread.lastReceived);
                  var replyParts = thread.replyId.split(";-;");
                  var replyAddress = replyParts[replyParts.length - 1];
                  var dbThread = {
                     _kind: "com.wosa.imessage.chatthread:1",
                     flags:{visible:true},
                     normalizedAddress: username,
                     displayName: thread.name,
                     replyAddress: replyAddress,
                     iMessageReplyId: thread.replyId,
                     replyService: "iMessage",
                     summary: thread.lastMessage,
                     iMessageId: thread.id,
                     timestamp: msgTS,
                     iMessageLastReceived: thread.lastReceived,
                  };
                  DB.put([dbThread]).then(function(chatput) {
                     if (chatput.result.returnValue === true) {
                        var newId = chatput.result.results[0].id;
                        logNoticeably("put chat thread for iMessage id: " + thread.id + ", syncing initial messages...");
                        // Sync messages now that we have the DB8 _id — no recursion risk because
                        // we're calling syncChat directly, not sync, and the thread record exists.
                        PalmCall.call("palm://com.wosa.imessage.service/", "syncChat", {
                           conversationId: newId,
                           iMessageId: thread.id,
                           replyId: thread.replyId
                        });
                     } else {
                        logNoticeably("FAILED to put chat thread for iMessage id: " + thread.id);
                     }
                  });
               })(thisThread);
            }
         }
         // Don't recursively call sync here - new threads will be populated on the next periodic sync.
         // A recursive call races against the fire-and-forget DB.put calls above: if puts haven't
         // completed yet, the recursive sync won't see the new threads, creates them again, and loops.
      }
   });

   logNoticeably("ALL DONE SYNCING!");
   logNoticeably("Scheduling next syncs...");
   var syncActivity =
   {
      "start": true,
      "replace": true,
      "activity": {
         "name": "iMessagePeriodicSync",
         "description": "Recreate Periodic Sync of incoming messages from iMessage",
         "type": {
            "foreground": true,
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
   // Set up a DB-triggered activity so processOutbox fires immediately when any message
   // is put to the outbox with status=pending. Pattern from synergv2 (ericblade):
   // "key":"fired" tells ActivityManager to watch for fired:true in the db/watch response.
   // persist:true + restart:true in complete() keeps the watch alive continuously.
   var outboxWatchActivity = {
      "start": true,
      "replace": true,
      "activity": {
         "name": "iMessageOutboxWatch",
         "description": "Watch for pending iMessage outbox messages to send",
         "type": {
            "foreground": true,
            "power": true,
            "powerDebounce": true,
            "explicit": true,
            "persist": true
         },
         "requirements": {
            "internet": true
         },
         "trigger": {
            "method": "palm://com.palm.db/watch",
            "key": "fired",
            "params": {
               "query": {
                  "from": "com.wosa.imessage.immessage:1",
                  "where": [
                     {"prop": "status", "op": "=", "val": "pending"},
                     {"prop": "folder", "op": "=", "val": "outbox"}
                  ]
               },
               "subscribe": true
            }
         },
         "callback": {
            "method": "palm://com.wosa.imessage.service/processOutbox",
            "params": {}
         }
      }
   };
   PalmCall.call("palm://com.palm.activitymanager/", "create", outboxWatchActivity).then(function(f) {
      logNoticeably("outbox watch activity create result=" + JSON.stringify(f.result));
   });

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
   //TODO: This results in a commandTimeout and I don't know why. Maybe make subscribable?
   // https://sdk.webosarchive.org/docs/dev-guide/js-services/services-faq.html
   var args = this.controller.args;
   if (!args || !args.conversationId || !args.iMessageId || !args.replyId) {
      future.result = {returnValue: false};
      return;
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
         future.result = { returnValue: false };
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
   
            //Next (in the "future") we'll get our saved messages for this thread
            var q = {"from":"com.wosa.imessage.immessage:1", "where": [{"prop": "iMessageId", "op": "=", "val": iMessageThreadId}]};
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
      if (!future.result.returnValue) {
         return;
      }
      if (future.result.results && future.result.results.length > 0) {
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

         var imsgDispatches = JSON.parse(body);
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
      future.result = { returnValue: true };
   });
   future.result = { returnValue: true };
}

var periodicSync = function(future){}
periodicSync.prototype.run = function(future) {
   logNoticeably("periodicSync run");
   PalmCall.call("palm://com.wosa.imessage.service/", "sync", {timedSync: true});
   PalmCall.call("palm://com.wosa.imessage.service/", "processOutbox", {});
   future.result = { returnValue: true };
};
periodicSync.prototype.complete = function() {
   logNoticeably("periodicSync complete!");
}

// The Synergy framework does not automatically call sendIM when a message is put to the outbox.
// processOutbox finds all pending outbox messages and dispatches each to sendIM. It is called
// both by periodicSync (fallback) and by the iMessageOutboxWatch ActivityManager DB-trigger
// activity (immediate response). The complete() method uses restart:true to re-arm the watch.
var processOutbox = function(future){};
processOutbox.prototype.run = function(future) {
   logNoticeably("processOutbox: checking for pending and failed outbox messages");
   var maxRetries = 3;
   var allMessages = [];
   // Index order must match the statusFolder compound index: status first, then folder.
   var pendingQ = {"query": {
      "from": "com.wosa.imessage.immessage:1",
      "where": [
         {"prop": "status", "op": "=", "val": "pending"},
         {"prop": "folder", "op": "=", "val": "outbox"}
      ]
   }};
   var failedQ = {"query": {
      "from": "com.wosa.imessage.immessage:1",
      "where": [
         {"prop": "status", "op": "=", "val": "failed"},
         {"prop": "folder", "op": "=", "val": "outbox"}
      ]
   }};
   var pf = PalmCall.call("palm://com.palm.db/", "find", pendingQ).then(function(f) {
      if (f.result.returnValue === true && f.result.results && f.result.results.length > 0) {
         for (var i = 0; i < f.result.results.length; i++) {
            allMessages.push(f.result.results[i]);
         }
      }
      return PalmCall.call("palm://com.palm.db/", "find", failedQ);
   });
   pf.then(function(f) {
      if (f.result.returnValue === true && f.result.results && f.result.results.length > 0) {
         for (var i = 0; i < f.result.results.length; i++) {
            var msg = f.result.results[i];
            var attempts = msg.sendAttempts || 0;
            if (attempts < maxRetries) {
               logNoticeably("processOutbox: queuing retry for failed _id=" + msg._id + " (attempt " + (attempts + 1) + ")");
               allMessages.push(msg);
            } else {
               logNoticeably("processOutbox: giving up on _id=" + msg._id + " after " + attempts + " failed attempts");
            }
         }
      }
      if (allMessages.length > 0) {
         logNoticeably("processOutbox: dispatching sendIM for " + allMessages.length + " message(s)");
         for (var i = 0; i < allMessages.length; i++) {
            logNoticeably("processOutbox: dispatching sendIM for _id=" + allMessages[i]._id + " text=" + allMessages[i].messageText);
            PalmCall.call("palm://com.wosa.imessage.service/", "sendIM", allMessages[i]);
         }
      } else {
         logNoticeably("processOutbox: no outbox messages to process");
      }
   });
   future.result = {returnValue: true};
};
processOutbox.prototype.complete = function() {
   logNoticeably("processOutbox complete");
   // Re-arm the DB-trigger activity so it fires again on the next pending outbox message.
   // When called via ActivityManager callback, activityId is set; when called directly it is not.
   if (this.controller && this.controller.activityId) {
      logNoticeably("processOutbox: restarting outbox watch activity");
      PalmCall.call("palm://com.palm.activitymanager/", "complete", {
         activityId: this.controller.activityId,
         restart: true
      });
   }
};

var onDeleteAssistant = function(future){};
onDeleteAssistant.prototype.run = function(future) { 
// Account deleted - Synergy service should delete account and config information here.

   var args = this.controller.args;
   logNoticeably("onDelete args =" + JSON.stringify(args));
   future.result = {returnValue: true};

   //Cancel activities (fire and forget)
   PalmCall.call("palm://com.palm.activitymanager/", "cancel", { "activityName":"iMessagePeriodicSync" });
   PalmCall.call("palm://com.palm.activitymanager/", "cancel", { "activityName":"iMessageOutboxWatch" });

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

   // Strip protocol prefix if the caller included it (e.g. "http://192.168.1.1")
   if (host.indexOf("://") !== -1) {
      host = host.split("://")[1];
   }
   // Strip any port already embedded in the host (use the port param instead)
   if (host.indexOf(":") !== -1) {
      host = host.split(":")[0];
   }

   var url = "http://" + host + ":" + port + path;
   var method = args.method || "GET";
   var body = args.body || null;

   if (method === "POST" && body) {
      var postOptions = {
         host: host,
         port: parseInt(port),
         path: path,
         method: "POST",
         headers: {
            "Content-Type": "application/json",
            "Content-Length": body.length
         }
      };
      logNoticeably("httpRequest POST to " + url + " body=" + body);
      var req = http.request(postOptions, function(res) {
         var responseData = "";
         res.on("data", function(chunk) { responseData += chunk; });
         res.on("end", function() {
            logNoticeably("httpRequest POST status=" + res.statusCode + " data=" + responseData);
            future.result = { returnValue: res.statusCode < 400, data: responseData };
         });
      });
      req.on("error", function(e) {
         logNoticeably("httpRequest POST network error: " + e.message);
         future.result = { returnValue: false, data: "" };
      });
      req.write(body);
      req.end();
   } else {
      var cmd = "wget -q -O - " + url;
      console.log("Child Process command: " + cmd);
      child_process.exec(cmd, function(error, stdout, stderr) {
         future.result = { returnValue: error == null, data: stdout, file: args.savefile };
      });
   }
   return;
}

var sendIM = function(future){};
sendIM.prototype.run = function(future) {
   var args = this.controller.args;
   logNoticeably("sendIM args =" + JSON.stringify(args));

   if (!args || !args.messageText) {
      logNoticeably("sendIM: missing required messageText");
      future.result = {returnValue: false};
      return;
   }

   var syncServer = "";
   var syncPort = 8080;
   var messageText = args.messageText;
   var iMessageReplyId = null;
   var conversationDbId = null;
   var iMessageThreadNumericId = null;
   // webOS pre-creates a pending DB8 record and passes its _id here so we can update it.
   // Check multiple possible field names for compatibility.
   var pendingMsgId = args._id || (args.message && args.message._id) || null;
   logNoticeably("sendIM: pendingMsgId=" + pendingMsgId);

   // Step 1: Get transport config
   var q = {"query":{"from":"com.wosa.imessage.transport:1"}};
   var f = PalmCall.call("palm://com.palm.db/", "find", q).then(function(future) {
      if (future.result.returnValue === true && future.result.results && future.result.results.length > 0) {
         syncServer = future.result.results[0].messageBridgeServer;
         syncPort = future.result.results[0].messageBridgePort;
         if (syncServer.indexOf("http:") != -1) {
            syncServer = syncServer.replace("http://", "");
            var parts = syncServer.split(":");
            syncServer = parts[0];
         }
         // Step 2: Look up the chat thread to get iMessageReplyId for the Message Bridge POST.
         // The message record has to[0].addr (not a top-level replyAddress field), and
         // args.conversations[0] is the chatthread's DB8 _id — use that for a direct get.
         var conversationsId = (args.conversations && args.conversations.length > 0) ? args.conversations[0] : null;
         if (conversationsId) {
            logNoticeably("sendIM: looking up thread by conversations id=" + conversationsId);
            return PalmCall.call("palm://com.palm.db/", "get", {"ids": [conversationsId]});
         } else {
            // Fallback: search by address (args.replyAddress or args.to[0].addr)
            var lookupAddr = "";
            if (args.replyAddress) {
               lookupAddr = Array.isArray(args.replyAddress) ? args.replyAddress[args.replyAddress.length - 1] : args.replyAddress;
            } else if (args.to && args.to.length > 0) {
               lookupAddr = args.to[0].addr || "";
            }
            logNoticeably("sendIM: looking up thread by replyAddress=" + lookupAddr);
            var threadQuery = {"from":"com.wosa.imessage.chatthread:1", "where":[{"prop":"replyAddress","op":"=","val":lookupAddr}]};
            return DB.find(threadQuery, false, false);
         }
      } else {
         logNoticeably("sendIM: could not find transport config");
         future.result = {returnValue: false};
      }
   });

   // Step 3: POST message to Message Bridge via http.request (BusyBox wget lacks --post-file/--post-data)
   f.then(this, function(future) {
      if (!future.result.returnValue) return;
      if (!future.result.results || future.result.results.length === 0) {
         logNoticeably("sendIM: could not find matching chat thread for replyAddress=" + JSON.stringify(args.replyAddress));
         future.result = {returnValue: false};
         return;
      }
      var thread = future.result.results[0];
      iMessageReplyId = thread.iMessageReplyId;
      conversationDbId = thread._id;
      iMessageThreadNumericId = thread.iMessageId;
      logNoticeably("sendIM: posting message to thread " + iMessageReplyId + " via " + syncServer + ":" + syncPort);
      var postBody = JSON.stringify({address: iMessageReplyId, isReply: true, message: messageText});
      logNoticeably("sendIM: POST body=" + postBody);
      var httpFuture = new Future();
      var postOptions = {
         host: syncServer,
         port: parseInt(syncPort),
         path: "/chats",
         method: "POST",
         headers: {
            "Content-Type": "application/json",
            "Content-Length": postBody.length
         }
      };
      var req = http.request(postOptions, function(res) {
         var responseData = "";
         res.on("data", function(chunk) { responseData += chunk; });
         res.on("end", function() {
            logNoticeably("sendIM: POST status=" + res.statusCode + " data=" + responseData);
            httpFuture.result = {returnValue: res.statusCode < 400, statusCode: res.statusCode, data: responseData};
         });
      });
      req.on("error", function(e) {
         logNoticeably("sendIM: POST network error: " + e.message);
         httpFuture.result = {returnValue: false, statusCode: 0, data: ""};
      });
      req.write(postBody);
      req.end();
      return httpFuture;
   });

   // Step 4: Mark the pre-created pending message as successful (or create one if none exists).
   // webOS creates a DB8 record with status:"pending" before calling sendIM and expects us to
   // flip it to "successful" — if we create a new record instead, the original stays stuck forever.
   f.then(this, function(future) {
      if (!future.result.returnValue) {
         logNoticeably("sendIM: POST to Message Bridge failed");
         if (pendingMsgId) {
            var attempts = (args.sendAttempts || 0) + 1;
            DB.merge([{_kind: "com.wosa.imessage.immessage:1", "_id": pendingMsgId, "status": "failed", "sendAttempts": attempts}]).then(function(r) {
               logNoticeably("sendIM: marked pending message as failed (attempt " + attempts + "), result=" + JSON.stringify(r.result));
            });
         }
         future.result = {returnValue: false};
         return;
      }
      logNoticeably("sendIM: Message Bridge accepted send, response=" + future.result.data);
      if (pendingMsgId) {
         logNoticeably("sendIM: updating pre-created pending message " + pendingMsgId + " to successful");
         return DB.merge([{_kind: "com.wosa.imessage.immessage:1", "_id": pendingMsgId, "status": "successful"}]);
      } else {
         logNoticeably("sendIM: no pendingMsgId, creating new outbound message record");
         var msgTS = new Date().getTime();
         var recipientAddr = iMessageReplyId ? iMessageReplyId.split(";-;").pop() : "";
         var dbMsg = {
            _kind: "com.wosa.imessage.immessage:1",
            _sync: true,
            flags: {read: true},
            folder: "outbox",
            conversations: [conversationDbId],
            localTimestamp: msgTS,
            messageText: messageText,
            serviceName: "iMessage",
            status: "successful",
            to: [{addr: recipientAddr, name: recipientAddr}],
            iMessageId: iMessageThreadNumericId,
         };
         return DB.put([dbMsg]);
      }
   });

   // Step 5: Update thread summary so the chat list reflects the sent message
   f.then(this, function(future) {
      if (future.result.returnValue === true) {
         logNoticeably("sendIM: stored outbound message in DB8");
         var msgTS = new Date().getTime();
         DB.merge([{_kind:"com.wosa.imessage.chatthread:1", "_id":conversationDbId, "summary":messageText, "timestamp":msgTS}]).then(function(r) {
            logNoticeably("sendIM: updated thread summary");
         });
      } else {
         logNoticeably("sendIM: failed to store outbound message");
      }
      future.result = {returnValue: true};
   });

   future.result = {returnValue: true};
};