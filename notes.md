# Synergy Notes

Notes intended to augment the documentation found here: https://sdk.webosarchive.org/docs/dev-guide/synergy/overview.html

## Futures
- webOS was built before async ES6, and even before promises. Palm had their own solution called futures.
- They work like async -- the argument for a future-enabled function is the "call back" function that will be invoked with the async call is completed.
- Thus futures can be nested within another futures callback...
```
futuristicFunction(futuristicCallback {
    futuristicFunction2(futuristicCallBack2 {

    });
});
```

## Kinds
- Not to be confused with Enyo's kinds (which are usually user-oriented) DB8 will only store data of a pre-declared structure **kind**.
- These structures usually (always?) derive from a pre-existing kind.
- Apps many usually only interact with their own kinds. But the kind owner may grant another app permission to interact with its own kinds.
- Since apps can't interact with Palm's kinds, they need to derive a sub-kind that they *can* interact with.
- Thus an app that wants to sync contacts must derive its own sub-kind of contacts which it can control -- without effecting the contacts that Palm's contact kind created.
- I suspect (but do not know) that parent kind owners can probably also interact with descended kinds.
- Kinds are defined in the service/configuration/db/kinds folder.

## Storing/Retreiving Data
- Data is stored in DB8 and you can put or get with JSON queries like: `var q ={ "query":{ "from":"com.wosa.imessage.immessage:1", "where":[{"prop":"accountId","op":"=","val":args.accountId}] }};`
- You can interact with DB8 using Palm calls and Futures like: `PalmCall.call("palm://com.palm.db/", "get", q).then( function(futureResult) {});`
- But Foundations includes an abstraction library called DB that makes things a little easier: `DB.find(q, false, false).then(function(futureResult) {});`
- If you use the DB library your queries should *not* be wrapped in "query:{}" -- you just need the contents of the query.
- Use Impostah (in Preware) to inspect DB records

## Adding Messages
- The Messages app uses two kinds (and their registered derivations): `com.palm.chatthread:1` and `com.palm.message:1`
- As noted above, only Palm apps can insert new data of these base kinds, but your app can derive its own sub-kinds and insert/delete/update those.
- All kinds and subkinds records in DB8 from the two base messaging kinds will be automatically rendered in the messaging app -- as long as their structure and required fields are *perfectly* populated!
- `chatthread` records are the data for the chat list on the left of the Messages UI
- `message` records are data for the individual messages in a chat thread
- `message` records include a field called `conversations` that is a (single item) array that is the id of the chatthread the message belongs to
- If a `message` record is inserted that does have the `conversations` array populated, a new `chatthread` will be created -- be careful with your own message kinds, as its the apps responsibility to link messages to the newly created `chatthread`
- You can see the behavior on the command line by instructing the OS to create standard messaging records via the Luna servicebus -- you cannot do this in your own app, however, because your app can only interact with its own kinds (see above)...

```
#outbound unthreaded message
luna-send -n 1 -a com.palm.app.messaging palm://com.palm.db/put '{"objects":[ {"_kind":"com.wosa.imessage.immessage:1","_sync":true,"flags":{"visible":true},"folder":"outbox","localTimestamp":1530497493511,"messageText":"Sending a message that has no chat thread","serviceName":"type_iMessage","status":"successful","to":[{"addr":"555-1234","name":"Some Recipient"}]}]}'

#inbound unthreaded message
luna-send -n 1 -a com.palm.app.messaging palm://com.palm.db/put '{"objects":[ {"_kind":"com.wosa.imessage.immessage:1","_sync":true,"flags":{"visible":true},"folder":"inbox","localTimestamp":1707599949529,"messageText":"Receiving a message that has no chat thread","serviceName":"type_iMessage","status":"successful","replyAddress":"555-1234","displayName":"Sender Name","from":[{"addr":"5551234","name":"This Sender"}],"to":[{"addr":"5551234","name":"This Recipient"}]}]}'

#outbound threaded message
luna-send -n 1 -a com.palm.app.messaging palm://com.palm.db/put '{"objects":[ {"_kind":"com.wosa.imessage.immessage:1","_sync":true,"conversations":["++NG2jk9ODNPXe6E"],"flags":{"visible":true},"folder":"outbox","localTimestamp":1428816144250,"messageText":"Sending a message that belongs to an existing chat thread with conversation ID ++NG2jk9ODNPXe6E","readRevSet":1774230,"serviceName":"sms","status":"pending","to":[{"_id":"1b1297","addr":"5551234","name":"This Sender"}]}]}'
```

Thanks to grabber for the sample luna commands

## Syncing

```
luna-send -n 1 -a com.wosa.imessage.service palm://com.wosa.imessage.service/sync '{}'
```

### ActivityManager
This webOS service is used to schedule background (low priority) or foreground (high priority) tasks, like syncing from a webservice. I was unsuccessful in setting it up per the SDK documentation, but code from EricBlade worked. You define the task using JSON, then schedule it with a Palm service call. See the serviceEndPoints.js code and comments for details.

## Code Samples
### Make a chat message without an existing thread
```
var msgsToStore = [];
var dbMsg = {
    _kind:"com.wosa.imessage.immessage:1",
    _sync:true,
    flags:{visible:true},
    folder:"inbox",
    localTimestamp: dt.getTime(),
    messageText:"Sample unthreaded message",
    serviceName:"type_iMessage",
    status:"successful",
    from:[{"addr":"5551234","name":"Jon Tester"}],
    to:[{ addr: username }],
}
msgsToStore.push(dbMsg);
DB.put(msgsToStore).then(function(myfuture) {
    logNoticeably("DB put result: " + JSON.stringify(myfuture.result));
    future.result = {returnValue: true};                           
});
```
### Make a chat thread
```
var dt = new Date();
var dbThread = {
    _kind: "com.wosa.imessage.chatthread:1",
    flags:{outgoing:false, visible:true},
    normalizedAddress: username,
    displayName: "TestThread",
    replyAddress: "555-1234",
    replyService: "sms",
    summary: "This is a test",
    iMessageId: 111,
    timestamp: dt.getTime(),
}
DB.put([dbThread]).then(function(chatput) {
    logNoticeably("thread DB put result: " + JSON.stringify(chatput.result));
    threadId = chatput.result.results[0].id;
}
```
### Add a chat message to an existing thread
```
var msgsToStore = [];
var dbMsg = {
    _kind:"com.wosa.imessage.immessage:1",
    _sync:true,
    flags:{visible:true},
    folder:"inbox",
    localTimestamp: dt.getTime(),
    conversations: [threadId],
    messageText:"Sample unthreaded message",
    serviceName:"type_iMessage",
    status:"successful",
    from:[{"addr":"5551234","name":"Jon Tester"}],
    to:[{ addr: username }],
}
msgsToStore.push(dbMsg);
DB.put(msgsToStore).then(function(myfuture) {
    logNoticeably("DB put result: " + JSON.stringify(myfuture.result));
    future.result = {returnValue: true};                           
});
```

## Debugging
- Launch novaterm (or otherwise get shell access)
- Follow messages with: `tail -f /var/log/messages`
- or use `ls-monitor`
- Note: once used by Synergy, the code gets copied into a jail and run from there -- that means that installing new code doesn't matter. You need to remove the account from Synergy, wait for it to clean-up, uninstall your code, restart Luna, then re-install your code.
- Restart Luna with: `luna-send -n 1 luna://org.webosinternals.ipkgservice/restartLuna '{}'`
- To avoid this, you can interact with your service *without* adding a Synergy account:
- Instruct a service to sync: `luna-send -n 1 -a com.wosa.imessage.service palm://com.wosa.imessage.service/sync '{}'`