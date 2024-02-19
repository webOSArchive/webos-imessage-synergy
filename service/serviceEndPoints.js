require.paths.push("./node_modules");
var request = require('request');

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
   var syncURL = "";
   var transportConfigId;
   var storedChatThreads = [];
   var storedMessages = [];

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
            syncURL = future.result.results[0].messageBridgeServer;

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
         syncURL = syncURL + ""; //auth would be added here
         if (syncURL != "") {
            logNoticeably("syncURL="+syncURL +"\n");
            logNoticeably("sync credentials="+username + " - " + password +"\n");
   
            //Next (in the "future") we'll get our saved chatthreads
            var q = {"from":"com.wosa.imessage.chatthread:1"};
            return DB.find(q, false, false)   
         } else {
            logNoticeably("The SyncURL was not defined, so sync cannot proceed");
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
         
      //Next (in the "future") we'll get our saved messages
      var q = {"from":"com.wosa.imessage.immessage:1"};
      return DB.find(q, false, false);
   });

   //Retreive our saved messages from db8
   f.then(this, function(future) {
      if (future.result.results.length > 0) {
         storedMessages = future.result.results;
      }
      
      logNoticeably("making chat requests call! ");
      // Get all remote conversations from server
      request(syncURL, function (error, response, body) {
         logNoticeably("in chat requests call! ");
         var createdChatThread = false;
         var createdInitialMessage = false;
         if (!error && response.statusCode == 200) {
            logNoticeably("requests body: " + body);
            var imsgThreads = JSON.parse(body);
            logNoticeably("existing chatthreads: " + JSON.stringify(storedChatThreads));
            if (storedChatThreads.length > 0) {
               // For each stored chat thread, look for messages that update them (ignore messages with no chat)
               for (var j=0;j<storedChatThreads.length;j++) {
                  var thisChat = storedChatThreads[j];
                  logNoticeably("looking for new messages for chatthread: " + thisChat.iMessageId);
                  for (var i=0;i<imsgThreads.length;i++) {
                     var thisThread = imsgThreads[i];
                     //TODO: the iMessage ID is really the iMessage thread ID, we also need to store the individual message id
                     if (thisChat.iMessageId && thisThread.id == thisChat.iMessageId) {
                        logNoticeably("found an existing thread for imessage id: " + thisChat.iMessageId + ", checking if message already exists...");
                        var foundInitialMessage = false;
                        for (var m=0;m<storedMessages.length;m++) {
                           var thisStoredMsg = storedMessages[m];
                           if (thisStoredMsg.iMessageId == thisChat.iMessageId && thisStoredMsg.iDispatchId == thisThread.lastMessageId)
                              foundInitialMessage = true;
                        }
                        if (!foundInitialMessage) {
                           logNoticeably("no message exists for thread with imessage id: " + thisChat.iMessageId + ", creating one");
                           createdInitialMessage = true;
                           var msgTS = Date.parse(thisThread.lastReceived);
                           var dbMsg = {
                              _kind:"com.wosa.imessage.immessage:1",
                              _sync:true,
                              flags:{visible:true},
                              folder: "inbox",
                              conversations: [thisChat._id],
                              localTimestamp: msgTS,
                              messageText: thisThread.lastMessage,
                              serviceName: "iMessage",
                              status: "successful",
                              from: [{ addr:thisThread.replyId, name: thisThread.name }],
                              to: { addr: username, name: username },
                              username: username,
                              iMessageId: thisThread.id,
                              iDispatchId: thisThread.lastMessageId,
                           }
                           logNoticeably("new initial message for existing thread with id: " + thisChat._id + " is: " + JSON.stringify(dbMsg));
                           //This is a fire and forget future call...
                           DB.put([dbMsg]).then(function(f3) {
                              logNoticeably("DB put result: " + JSON.stringify(f3.result));
                           });
                        } else {
                           logNoticeably("messages already exist for thread with imessage id: " + thisChat.iMessageId + ", NOT creating new initial message");
                        }
                     }
                  }
               }
            }
            // When done processing existing chat threads, create new chat threads where needed
            logNoticeably("checking if new chats need to be created!");
            for (var i=0;i<imsgThreads.length;i++) {
               //Check if each chat thread's initial message already exists in the database
               var thisThread = imsgThreads[i];
               var found = false;
               for (var j=0;j<storedChatThreads.length;j++) {
                  var thisChat = storedChatThreads[j];
                  if (thisChat.iMessageId == thisThread.id) {
                     found = true;
                     break;
                  }
               }
               if (!found) {
                  //If the incoming initial chat thread message does not exist, create it
                  logNoticeably("the remote thread with id " + thisThread.id + " did not exist locally, creating...");
                  createdChatThread = true;
                  var msgTS = Date.parse(thisThread.lastReceived);
                  var replyAddress = thisThread.replyId.split(";-;");
                  replyAddincomingress = replyAddress[replyAddress.length-1];
                  var dbThread = {
                     _kind: "com.wosa.imessage.chatthread:1",
                     flags:{outgoing:false, visible:true},
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
               } else {
                  logNoticeably("the remote thread with id " + thisThread.id + " already existed locally, skipping!");
               }
            }
            // If chat threads were created, order another sync
            if (createdChatThread) {
               PalmCall.call("palm://com.wosa.imessage.service/", "sync", {}).then(function(syncResult) {
                  logNoticeably("a follow-up sync has been scheduled to populate initial messages!");
               });
            } else {
               if (createdInitialMessage) {
                  PalmCall.call("palm://com.wosa.imessage.service/", "sync", {}).then(function(syncResult) {
                     logNoticeably("a follow-up sync has been scheduled to populate historical messages!");
                  });
               } else {
                  //Next get historical messages for all populated threads
                  for (var c=0;c<storedChatThreads.length;c++) {
                     var thisChat = storedChatThreads[c];
                     logNoticeably("GO GET history for chatthread id: " + thisChat.iMessageId);
                     var historyURL = syncURL + "/" + thisChat.iMessageId + "/messages";
                     logNoticeably("GO GET history with URL: " + historyURL);
                     request(historyURL, function (error, response, body) {
                        logNoticeably("in message history requests call! ");
                        if (!error && response.statusCode == 200) {
                           logNoticeably("got message history response, checking if messages need to be created! ");
                           var imsgDispatches = JSON.parse(body);
                           for (var d=0;d<imsgDispatches.length;d++) {
                              var thisDispatch=imsgDispatches[d];
                              logNoticeably("checking if message exists in db: " + JSON.stringify(thisDispatch));
                              var foundStoredDispatch = false;
                              for (var s=0;s<storedMessages.length;s++) {
                                 var thisStoredMsg = storedMessages[s];
                                 if (thisStoredMsg.iDispatchId == thisDispatch.id) {
                                    foundStoredDispatch = true;
                                    break;
                                 }
                              }
                              if (!foundStoredDispatch) {
                                 logNoticeably("incoming dispatch with id " + thisDispatch.id + " needs to be created...");
                                 var useChat;
                                 for (var t=0;t<storedChatThreads.length;t++) {
                                    var thisChat = storedChatThreads[t];
                                    if (thisChat.iMessageId == thisDispatch.chatId) {
                                       useChat = thisChat;
                                       logNoticeably("incoming dispatch with id " + thisDispatch.id + " belongs to conversation: " + useChat._id);
                                       break;
                                    }
                                 }
                                 var msgTS = Date.parse(thisDispatch.received);
                                 var dbMsg = {
                                    _kind:"com.wosa.imessage.immessage:1",
                                    _sync:true,
                                    flags:{visible:true},
                                    folder: "inbox",
                                    conversations: [useChat._id],
                                    localTimestamp: msgTS,
                                    messageText: thisDispatch.body,
                                    serviceName: "iMessage",
                                    status: "successful",
                                    from: { addr:thisChat.replyAddress },
                                    to: { addr: username, name: username },
                                    username: username,
                                    iMessageId: thisDispatch.chatId,
                                    iDispatchId: thisDispatch.id,
                                 }
                                 logNoticeably("made message dispatch with id " + thisDispatch.id + ": " + JSON.stringify(dbMsg));
                                 //This is a fire and forget future call...
                                 DB.put([dbMsg]).then(function(chatput) {
                                    logNoticeably("put new dispatch for iMessage id: " + thisThread.id);
                                 });

                              } else {
                                 //TODO: Update existing messages
                                 //    check if most recent message isme: is true (outbox) or false (inbox)
                                 logNoticeably("incoming dispatch with id " + thisDispatch.id + " is already stored");
                              }
                           }
                        } else {
                           logNoticeably("message history requests error: " + error) // Print the response body
                           future.result = {returnValue: false};
                        }
                     });
                  }
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
                           "interval": "1m"
                        },
                        "callback": {
                           "method": "palm://com.wosa.imessage.service/periodicSync",
                           "params": {timedSync: true}
                        }
                     }
                  };
                  // for some reason, the activity no longer exists by the time we get here, so instead of
                  // completing it, we re-create it. i guess.
                  logNoticeably("sync interval complete completed, restarting sync interval every 1m");
                  PalmCall.call("palm://com.palm.activitymanager/", "create", syncActivity).then(function(f) {
                     logNoticeably("activity create results=", JSON.stringify(f.result));
                     f.result = { returnValue: true };
                  }, function(f) {
                     logNoticeably("Something bad happened scheduling recurring sync. This is probably fatal!");
                     // TODO: trigger the app to display an error to the user ?
                  });
               }
            }
         } else {
            logNoticeably("chat requests error: " + error) // Show the response body
            future.result = {returnValue: false};
         }
      });
      future.result = {returnValue: true};
   });
   future.result = future.result;
};

var onDeleteAssistant = function(future){};
onDeleteAssistant.prototype.run = function(future) { 
// Account deleted - Synergy service should delete account and config information here.

   logNoticeably("onDelete args =" + JSON.stringify(args));
   future.result = {returnValue: true};
   var args = this.controller.args;
   var q ={ "query":{ "from":"com.wosa.imessage.immessage:1", "where":[{"prop":"accountId","op":"=","val":args.accountId}] }};
   PalmCall.call("palm://com.palm.db/", "del", q).then( function(f) 
   {
      if (f.result.returnValue !== true)
      {
         logNoticeably("an error occured cleaning up messages");
      }
      //Delete our housekeeping/sync data
      var q2 = {"query":{"from":"com.wosa.imessage.transport:1"}};
      PalmCall.call("palm://com.palm.db/", "del", q2).then( function(f1) 
      {
         if (f1.result.returnValue !== true)
         {
            logNoticeably("an error occured cleaning up iMessage Bridge sync info");
         }
         //Delete our account username/password from key store
         PalmCall.call("palm://com.palm.keymanager/", "remove", {"keyname" : "AcctUsername"}).then( function(f2) 
         {
            if (f2.result.returnValue !== true)
            {
               logNoticeably("an error occured removing iMessage Username");
            }
            PalmCall.call("palm://com.palm.keymanager/", "remove", {"keyname" : "AcctPassword"}).then( function(f3) 
            {
               if (f2.result.returnValue !== true)
               {
                  logNoticeably("an error occured removing iMessage Password");
               }
            });
         });
      });
   });
   future.result = {returnValue: true};
};

//TODO...

var sendIM = function(future){};
sendIM.prototype.run = function(future) { 
   logNoticeably("sendIM args =" + JSON.stringify(args));
   future.result = {returnValue: true};
}