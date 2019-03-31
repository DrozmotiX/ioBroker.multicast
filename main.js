"use strict";

/*
 * Created with @iobroker/create-adapter v1.8.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");

// Load your modules here, e.g.:
const dgram = require("dgram");

// Here Global variables
let receive_ip, receive_port, send_ip, send_port, multicast, timeout;
const send_Delay = 200;

class Multicast extends utils.Adapter {

	/**
	 * @param {Partial<ioBroker.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: "multicast",
		});
		this.on("ready", this.onReady);
		this.on("objectChange", this.onObjectChange);
		this.on("stateChange", this.onStateChange);
		// this.on("message", this.onMessage);
		this.on("unload", this.onUnload);
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	onReady() {
		// Init your Adapter here
		receive_ip = this.config.receive_1 + "." + this.config.receive_2 + "." + this.config.receive_3 + "." + this.config.receive_4;
		receive_port = this.config.receive_port;
		send_ip = this.config.send_1 + "." + this.config.send_2 + "." + this.config.send_3 + "." + this.config.send_4;
		send_port = this.config.send_port;

		// Write logging of configuration values in silly mode
		this.log.silly("IP-Adress Receiver = : " + receive_ip);
		this.log.silly("Port des Receivers = : " + receive_port);
		this.log.silly("IP-Adress Sender = : " + send_ip);
		this.log.silly("Port des Senders = : " + send_port);

		// Create state to send global multicast message
		this.doStateCreate("global_message", "send a free multicast message", "string", "media.tts","", true);
		this.subscribeStates("global_message");

		// Open socket to receive multicast messages
		multicast = dgram.createSocket("udp4");
		multicast.on("listening", () => {
			const receiveaddress = multicast.address();
			multicast.addMembership(receive_ip);
			this.log.info("Multicast Client listening on " + receiveaddress.address + ":" + receiveaddress.port + "and send to " + send_ip + ":" + send_port);
		});

		// Bind UDP listener to receice port
		multicast.bind(receive_port);
		this.subscribeStates("*");
		// this.doTimesync();

		// Ack on message in multicast listener
		multicast.on("message", (message, remote) => {
			// Write logging received information source
			this.log.debug("From: " + remote.address + ":" + remote.port);
			this.log.debug("Packagelength: " + message.length);
			this.log.debug("Content of message encrypted: " + message);
			
			// To-Do : handle decryption of message
			this.log.debug("Content of message : " + message);
			try {
				//@ts-ignore message is available from function
				const received_data = JSON.parse(message);	// Versuch den String in ein JSON zu verwandeln
				const statename = received_data.i["Devicename"];
				// const statename = received_data.i["Type"] + "_" + received_data.i["MAC_Adress"];
				

				// read array if message is related to initialisation or state update
				if (received_data.Type == "Object") {
					// initialization
					this.log.debug("Data from device " + JSON.stringify(received_data));
					this.log.info("Data for device  " + statename + " received, initializing device");
					this.initialize(received_data, statename);
				
				} else if (received_data.Type == "State") {
					// state update
					this.stateupdate(received_data, true);

				} else if (received_data.Type == "StateInterval") {
					// state update
					this.stateupdate(received_data, false);
				}

			} catch (error) {

				//To-Do : ensure propper error logging for wrong firmware versions
				this.log.error(error);
				this.log.error("unknown message received - please read the documentation !!!! - this was received: " + message);
			}
		});

		/*
		setState examples
		you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
		*/
		// the variable testVariable is set to true as command (ack=false)
		// await this.setStateAsync("testVariable", true);

		// same thing, but the value is flagged "ack"
		// ack should be always set to true if the value is received from or acknowledged from the target system
		// await this.setStateAsync("testVariable", { val: true, ack: true });

		// same thing, but the state is deleted after 30s (getState will return null afterwards)
		// await this.setStateAsync("testVariable", { val: true, ack: true, expire: 30 });

		// examples for the checkPassword/checkGroup functions
		// let result = await this.checkPasswordAsync("admin", "iobroker");
		// this.log.info("check user admin pw ioboker: " + result);

		// result = await this.checkGroupAsync("admin", "admin");
		// this.log.info("check group user admin group admin: " + result);
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			this.log.info("cleaned everything up...");
			multicast.close();
			callback();
		} catch (e) {
			callback();
		}
	}

	/**
	 * Is called if a subscribed object changes
	 * @param {string} id
	 * @param {ioBroker.Object | null | undefined} obj
	 */
	onObjectChange(id, obj) {
		if (obj) {
			// The object was changed
			this.log.debug(`object ${id} changed: ${JSON.stringify(obj)}`);
		} else {
			// The object was deleted
			this.log.debug(`object ${id} deleted`);
		}
	}

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	async onStateChange(id, state) {
		if (state) {
			// The state was changed
			this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
		
			if (state.ack === false) {
				const deviceId = id.split(".");
				let stateNameToSend = "";
				for (let i=3; i <= deviceId.length-1; i++) {
					stateNameToSend += deviceId[i];
					if(i < (deviceId.length -1)) stateNameToSend += ".";
				}

				this.log.debug("statename: " + stateNameToSend);

				const objekt = await this.getObjectAsync(deviceId[2]);
				this.log.debug("Return of async getObject : " + JSON.stringify(objekt));
				if (objekt !== undefined && objekt !== null) {
					this.log.debug("AsyncObject received while StateChange: " + JSON.stringify(objekt));
					const sendMessage = {
						i : objekt.common,
						s : {[stateNameToSend] : state.val}				
					};
					// message here !
					this.transmit(JSON.stringify(sendMessage));
				}
			}		
		} else {
			// The state was deleted
			this.log.debug(`state ${id} deleted`);
		}
	}

	initialize(received_data, statename){

		// Create Device objekt
		this.setObjectNotExists(statename,{
			type: "device",
			common: {
				name : received_data.c["Hostname"].v
			},
			native: {},
		});

		// Read all device related information and write into object with extend objection function
		const objects = Object.keys(received_data.i);
		let array = [];
		for (const i in objects){
			// Prepare values to be extended in instance object
			array.push('"' + objects[i] + '" : "' + received_data.i[objects[i]] + '"');

			// Create state in info channel
			this.createChannel(statename, "info");

			// Info channel is always read only, set hardcoded
			const writable = false;

			this.log.debug('"' + objects[i] + '" : "' + received_data.i[objects[i]] + '"');

			// Check if state must contain min and max value
			const min = this.defineMin(received_data.i[objects[i]]);
			const max = this.defineMax(received_data.i[objects[i]]);

			// tdoStateCreate(device, name, type,role, unit, write)
			this.doStateCreate(statename + ".Info." + objects[i], objects[i] , "number", received_data.i[objects[i]].r,"", writable, min, max);
			this.setState(statename + ".Info." + objects[i], { val: received_data.i[objects[i]],ack: true});

		}

		// update name
		array.push('"' + "name" + '" : "' + received_data.c["Hostname"].v + '"');

		// Write attributes to device object
		array = JSON.parse("{" + array + "}"); //Finalize creation of object
		const objekt = {};
		objekt.common = array;

		timeout = setTimeout( () => {
		// message here !
			this.extendObject(statename, objekt, (err) => {
				if (err !== null){this.log.error("Changing alias name failed with : " + err);}
			});
		}, 2000);
		
		
		
		// Read all configuration related information and write into object with extend objection function
		// To-Do :  Implement cache for case JSON does not contain configuration data
		const config = Object.keys(received_data.c);
		for (const i in config){
			// Config channel is always writable, set hardcoded
			const writable = true;

			// Create state in info channel
			this.createChannel(statename, "Config");

			// Define if state must be part of channel and create state name
			let stateCreateName = statename + ".Config." + config[i];
			this.log.debug("stateCreateName before if : " + stateCreateName);
			if (received_data.c[config[i]].c === undefined){
				// do nothing
			}
			else { 
				stateCreateName = statename + ".Config." + received_data.c[config[i]].c + "." + config[i];
			}
			this.log.debug("stateCreateName after if : " + stateCreateName);
			
			// Check if state must contain min and max value
			const min = this.defineMin(received_data.c[config[i]]);
			const max = this.defineMax(received_data.c[config[i]]);

			this.log.debug('"' + config[i] + '" : "' + received_data.c[config[i]] + '"');

			// create state and update value 
			this.doStateCreate(stateCreateName, config[i] , received_data.c[config[i]].t, received_data.c[config[i]].r,received_data.c[config[i]].u, writable, min, max);
			this.setState(stateCreateName, { val: received_data.c[config[i]].v,ack: true});

			// if state has writable flag yes, subscribe on changes
			this.dosubscribe(stateCreateName, writable);

		}						

		// Create states for all values received in JSON
		// To-Do :  Implement cache for case JSON does not contain state data

		const stateNames = Object.keys(received_data.s);
		for (const i in stateNames){
			const writable = this.defineWritable(received_data.s[stateNames[i]]);

			// Define if state must be part of channel and create state name
			let stateCreateName = statename + "." + stateNames[i];
			this.log.debug("stateCreateName before if : " + stateCreateName);
			if (received_data.s[stateNames[i]].c === undefined){
				// do nothing
			}
			else { 
				stateCreateName = statename + "." + received_data.s[stateNames[i]].c + "." + stateNames[i];
			}
			this.log.debug("stateCreateName after if : " + stateCreateName);

			// Check if state must contain min and max value
			const min = this.defineMin(received_data.s[stateNames[i]]);
			const max = this.defineMax(received_data.s[stateNames[i]]);

			// create state and update value 
			this.doStateCreate(stateCreateName, stateNames[i], received_data.s[stateNames[i]].t, received_data.s[stateNames[i]].r,received_data.s[stateNames[i]].u, writable, min, max);
			
			this.log.debug("Value of intervall : " + received_data.c["Interval_Object"].v);
			this.setState(stateCreateName, { val: received_data.s[stateNames[i]].v,ack: true, expire: (received_data.c["Interval_Object"].v *3) + 2 });
			
			// if state has writable flag yes, subscribe on changes
			this.dosubscribe(stateCreateName, writable);
		}

		const confirm = {
			i : objekt.common,
			Type : "synced"				
		};
		// message here !
		this.log.info("Device " + statename + " successfully initiated");
		this.transmit(JSON.stringify(confirm));

	}

	// function to handle state updates
	async stateupdate(received_data, confirm){
		const stateNames = Object.keys(received_data.s);
		const exp_timer = await this.getStateAsync(this.namespace + ".Config.System.Interval_Measure");
		this.log.debug("Configured interval : " + this.namespace + " || " + exp_timer);

		for (const i in stateNames){

			const statename = this.namespace + "." + stateNames[i];
			this.log.debug("Statename to update : " + statename + " with value : " + received_data.s[stateNames[i]]);

			const deviceId = statename.split(".");
			let stateNameToSend = "";
			for (let i=3; i <= deviceId.length-1; i++) {
				stateNameToSend += deviceId[i];
				if(i < (deviceId.length -1)) stateNameToSend += ".";
			}			

			this.log.debug("Statename to sent : " + deviceId[2]);

			const objekt = await this.getObjectAsync(deviceId[2]);
			this.log.debug("Return of async getObject : " + JSON.stringify(objekt));
			if (objekt === undefined || objekt === null) {
				const sendMessage = {
					i : received_data.i,
					Type : "sync"				
				};
				// message here !
				this.transmit(JSON.stringify(sendMessage));
			
			} else {

				// update state
				// this.log.debug("Value of intervall : " + received_data.c["Interval"].v);
				this.setState(statename, { val: received_data.s[stateNames[i]],ack: true});
				
				if (confirm === true){

					const confirm = {
						i : objekt.common,
						Type : "OK"				
					};

					// timeout = setTimeout( () => {
					// message here !
					this.transmit(JSON.stringify(confirm));
					// }, send_Delay);
				}
			}
		}

	}

	// Function to handle state creation
	doStateCreate(device, name, type,role, unit, write,min, max){	
		
		this.setObjectNotExists(device, {
			type: "state",
			common: {
				name: name,
				type: type,
				role: role,
				read: true,
				write: write,
				unit: unit,
				min: min,
				max: max,
				def: 0,
			},
			native: {},
		});
	}

	defineMin (source) {
		this.log.debug("Raw min function : " + JSON.stringify(source));
		this.log.debug("Min : " + JSON.stringify(source.min));
		let min = "";
		if (source.min !== undefined){
			min = source.min;
		}
		return min;

	}

	defineMax (source) {
		this.log.debug("Raw max function : " + JSON.stringify(source));
		this.log.debug("Min : " + JSON.stringify(source.max));
		let max = "";
		if (source.min !== undefined){
			max = source.max;
		}
		return max;
	}

	defineWritable(source){
		let writable = false;
		if (source.w === undefined){
			writable = false;
		}
		else if (source.w === true || source.w === "true") { 
			writable =	true;
		}
		return writable;
	}

	dosubscribe (statename, writable){

		if (writable === true) {
			this.subscribeStates(statename);
			this.log.debug("State subscribed!: "+ statename);
		}

	}

	doTimesync(){
		// In case of error, use 10 minutes as default
		let intervall = 10000;
		if (this.config.Time_Sync !== undefined && this.config.Time_Sync !== null){
			intervall = (this.config.Time_Sync * 1000);
		}
		setInterval(() => {
			const TimeStamp = (new Date().getTime());
			const UnixTime = {
				i : {
					ts : TimeStamp
				},
				Type : "TimeSync"				
			};
			// message here !
			this.transmit(JSON.stringify(UnixTime));

		}, intervall);

	}

	// Send UDP message
	transmit(message){
		multicast.send(message, 0, message.length, parseInt(send_port) ,send_ip, (err, bytes) => {
			if (err) throw err;
			this.log.debug("UDP Message content : " + message);
			this.log.debug("UDP Nachricht an IP " + send_ip + " an Port "+ parseInt(send_port) + " wurde versendet! - Die Länge der Nachricht war " + message.length +" Bytes");	
		});
	}
}
//@ts-ignore .parent exists
if (module.parent) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<ioBroker.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new Multicast(options);
} else {
	// otherwise start the instance directly
	new Multicast();
}