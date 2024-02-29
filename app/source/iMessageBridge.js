enyo.kind({
	name: "iMessageBridge",
	kind: "VFlexBox",
	defaultServer: "",
	defaultPort: 8080,
	dbConfigId: null,
	useServer:null,
	usePort:null,

	components:[
		{kind: "DbService", dbKind: "enyo.bffs:1", onFailure: "dbFailure", components: [
            {name: "findBffs", method: "find", onSuccess: "findBffsSuccess"},
			{name: "findForSaveBffs", method: "find", onSuccess: "findForSaveBffsSuccess"},
			{name: "putBffs", method: "put", onSuccess: "putBffsSuccess"},
			{name: "mergeBffs", method: "merge", onSuccess: "putBffsSuccess"}   
        ]},
		{kind: "PalmService", name: "launchAppRequest", service: "palm://com.palm.applicationManager/", method: "open", onSuccess: "", onFailure: "" },
		{kind: "PalmService", name: "serviceSyncRequest", service: "palm://com.wosa.imessage.service/", method: "sync", onSuccess: "syncSuccess", onFailure: "syncFailure" },
		{kind: "PalmService", name: "checkServerConnection", service: "palm://com.wosa.imessage.service/", method: "httpRequest", onSuccess: "serverCheckSuccess", onFailure: "serverCheckFailure" },
		{kind: "ApplicationEvents", onWindowActivated: "handleActivate", onWindowDeactivated: "handleDeactivate", onApplicationRelaunch: "handleLaunchParam"},

		{ kind: "PageHeader", components: [
			{ kind: "Image", name: "headerIcon", src: "icon.png", flex:1, style:"width:32px; height:32px; margin:0px; padding:-10px; margin-right: 8px;" },
			{ name: "titleText", content: "iMessage Bridge", style:"margin-top:1px;", flex:1 },
			{ kind: "Spinner", name: "spinner"},
		]},
		
		{kind: "Scroller", flex: 1, className: "box-center", name: "mainscroller", components: [
			{name:"txtServerInfo", className: "footnote-text", style:"margin-top: 14px", content:"iMessage synchronization requires a Message Bridge server running on a Mac on your network. Enter the details of your server. For more information, visit:<br><a href='https://github.com/dremin/message-bridge'>https://github.com/dremin/message-bridge</a>"},
			{
				kind: "RowGroup",
				caption: "Server",
				pack: "center",
				align: "start",
				class: "enyo-first",
				components: [
					{ name: "imessageServer", kind: "Input", value: this.defaultServer, pack: "center", align: "start", lazy: false, onchange: "checkServer" },
				]
			},
			{
				kind: "RowGroup",
				caption: "Port",
				pack: "center",
				align: "start",
				components: [
					{ name: "imessagePort", kind: "Input", value: this.defaultPort, pack: "center", align: "start", lazy: false, onchange: "checkPort" },
				]
			},
			{name:"txtNote", className: "footnote-text", style:"margin-top: 8px", content:"<b>Note:</b> The sync service bypasses webOS proxy settings. Temporarily disable your proxy during this setup."},
			{kind: "Button", name:"btnSaveConfig", caption:$L("Save"),  onclick:"trySaveSettings"},
			{name:"txtAccountInfo", className: "footnote-text", style:"margin-top: 20px", content:"Complete the setup by creating an iMessage Bridge account in webOS Accounts."},
			{kind: "Button", name:"btnConfigAccount", caption:$L("Accounts"), onclick:"launchAccounts"},
			{name:"txtSyncInfo", kind: "HtmlContent", className: "footnote-text", style:"margin-top: 20px", content:"Synchronization is usually automatic, every 3 minutes. If there are issues, or if you've just set the server, manually start the sync here."},
			{kind: "Button", name:"btnSyncNow", caption:$L("Sync Now"), onclick:"doSyncNow", content:"", disabled: true},
			{name:"txtSyncStatus", kind: "HtmlContent", className: "footnote-text", style:"margin-top: 8px"},
		]},
		{
            kind: "Helpers.Updater", //Make sure the Updater Helper is included in your depends.json
            name: "myUpdater"
        },

		{kind: "AppMenu", components: [
			{caption: $L("About"), onclick: "showAbout"},
			{caption: $L("Reset"), onclick: "resetToDefaults"},
		]},
		{
            kind: "Dialog",
            name: "alert",
            lazy: false,
            components: [{
                layoutKind: "HFlexLayout",
                pack: "center",
                components: [
                    { name: "alertMsg", kind: "HtmlContent", flex: 1, pack: "center", align: "start", style: "text-align: center;" },
                ]
            }]
        },
	],

	create: function() {
		this.inherited(arguments);
		this.handleLaunchParam();
		this.applySettings();

		this.$.myUpdater.CheckForUpdate("iMessage Bridge");
	},

	handleActivate: function () {
		this.getSyncReadiness();
	},

	handleDeactivate: function () {
	},

	handleLaunchParam: function () {
		enyo.log("iMessage Bridge Helper app Launch params: " + JSON.stringify(enyo.windowParams));
	},

	showAbout: function() {
		var aboutMsg = "<div style='padding-bottom:12px;margin:auto 8px'>" + enyo.fetchAppInfo().title + " " + enyo.fetchAppInfo().version;
		if (enyo.fetchAppInfo().copyright)
			aboutMsg += " - " + enyo.fetchAppInfo().copyright;
		else
			aboutMsg += " by " + enyo.fetchAppInfo().vendor
		if (enyo.fetchAppInfo().ossRepo)
			aboutMsg += ". Source code and license available at:<br>" + enyo.fetchAppInfo().ossRepo;
		aboutMsg += "</div>";
		this.$.alertMsg.setContent(aboutMsg);
        this.$.alert.open();
	},
	launchAccounts: function() {
		this.$.launchAppRequest.call({"id": "com.palm.app.accounts", "params":{}});
	},
	checkServer: function() {
		var server = this.$.imessageServer.getValue();
		if (server == "" || server.length < 3) {
			this.$.alertMsg.setContent("Server must be at least 3 characters long!");
			this.$.alert.open();
			return false;
		}
		return true;
	},
	checkPort: function() {
		var valid = true;
		var port = this.$.imessagePort.getValue();
		port = parseInt(port)
		if (isNaN(port)) {
			valid = false;
		}
		if (port < 1 || port > 65535) {
			valid = false;
		}
		if (!valid) {
			this.$.alertMsg.setContent("Port must be a numerical value between 1 and 65535!");
			this.$.alert.open();
			return false;
		}
		return true;
	},
	getSyncReadiness: function() {
		//TODO: This confirms there's ever been a sync, but we should also check if there's CURRENTLY an account
		var q = {"query":{"from":"com.wosa.imessage.transport:1"}};
        this.$.findBffs.call(q);
	},
	findBffsSuccess: function(inSender, inResponse) {
        this.log("DB8 lookup results: " + enyo.json.stringify(inResponse));
		if (inResponse.results && Array.isArray(inResponse.results) && inResponse.results.length >0) {
			var result = inResponse.results[0];
			this.log("DB8 had sync record");
			this.dbConfigId = result._id;
			if (result.lastSync && result.messageBridgeServer && this.$.imessageServer.getValue().length > 3) {
				this.$.btnSyncNow.setDisabled(false);
				var localDate = new Date(result.lastSync.replace("Z", ""));
				this.$.txtSyncStatus.setContent("Last sync attempt: " + this.calcSyncDateTime(localDate));
			}
		}
	},
	trySaveSettings: function() {
		this.$.spinner.show();
		this.saveSettings();
		//Test connection
		this.useServer = this.$.imessageServer.getValue();
		this.usePort = this.$.imessagePort.getValue();
		
		var testQuery = {
			host: this.useServer,
			port: this.usePort,
			path: "/chats?limit=1",
			method: "GET",
			binary: false
		 }
		 enyo.log("Testing server connection with URL: " + JSON.stringify(testQuery));
		 this.$.checkServerConnection.call(testQuery);
		var q = {"query":{"from":"com.wosa.imessage.transport:1"}};
        this.$.findForSaveBffs.call(q);
	},
	findForSaveBffsSuccess: function() {
		//Write settings to DB8 for service to use
		if (!this.dbConfigId) {	//Create record if none existed
			enyo.log("Creating DB config record");
			var syncRec = [{ _kind: "com.wosa.imessage.transport:1", "messageBridgeServer":this.useServer, "messageBridgePort":this.usePort}];
			this.$.putBffs.call({objects: syncRec});	
		} else {	//Merge record if one already existed
			enyo.log("Updating DB config record with ID: " + this.dbConfigId);
			var syncRec = {"_id":this.dbConfigId, "messageBridgeServer":this.useServer, "messageBridgePort":this.usePort };
			this.$.mergeBffs.call({"objects": [syncRec]});
		}
		this.getSyncReadiness();
	},
	serverCheckSuccess: function(inSender, inResponse, inRequest) {
		this.$.spinner.hide();
		enyo.log("IN SUCCESS: " + JSON.stringify(inResponse));
		if (!inResponse || inResponse == "" || !inResponse.data || inResponse.data == "") {
			this.serverCheckFailure();
		} else {
			enyo.log("Server response: " + JSON.stringify(inResponse));
			enyo.windows.addBannerMessage("Message Bridge connected!", "{}");
		}
	},
	serverCheckFailure: function() {
		this.$.spinner.hide();
		var errorMsg = "<div style='padding-bottom:12px;margin:auto 8px'>A test connection to the specified server failed. Settings have been saved, but synchronization will likely fail. Temporarily disable any proxies, and check your connectivity and Message Bridge server status, then press Save again to re-test.</div>";
		this.$.alertMsg.setContent(errorMsg);
        this.$.alert.open();
	},
	putBffsSuccess: function(inSender, inResponse) {
        this.log("DB update success, results=" + enyo.json.stringify(inResponse));
    },
    dbFailure: function(inSender, inError, inRequest) {
        enyo.log(enyo.json.stringify(inError));
    },
	doSyncNow:function() {
		this.$.serviceSyncRequest.call({});
	},
	syncSuccess: function(inSender, inResponse) {
		enyo.windows.addBannerMessage("Recurring background sync started!", "{}");
		window.setTimeout(function () {
			this.getSyncReadiness();
		}.bind(this), 2000);
	},
	syncFailure: function(inSender, inResponse) {
		enyo.windows.addBannerMessage("Sync failure!", "{}");
		enyo.log("Background sync failure: " + enyo.json.stringify(inResponse));
		this.getSyncReadiness();
	},

	resetToDefaults: function(inSender) {
		this.$.imessageServer.setValue(this.defaultServer);
		this.$.imessagePort.setValue(this.defaultPort);
		this.saveSettings();
	},
	saveSettings: function() {
		Prefs.setCookie("server", this.$.imessageServer.getValue());
		Prefs.setCookie("port", this.$.imessagePort.getValue());
	},
	applySettings: function() {
		this.$.imessageServer.setValue(Prefs.getCookie("server", this.defaultServer));
		this.$.imessagePort.setValue(Prefs.getCookie("port", this.defaultPort));
	},
	calcSyncDateTime: function(syncDate)
	{
		var d = syncDate;
		var hour = d.getHours();
		var minutes = d.getMinutes();
		var seconds = d.getSeconds();

		if (seconds < 10) seconds = "0"+seconds;
		if (minutes < 10) minutes = "0"+minutes;
		if (hour < 10)  hour= "0"+hour;

		var syncDateTime = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate() +" "+hour+":"+minutes+":"+seconds+""; 
		return(syncDateTime);
	}
});
