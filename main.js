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
let receive_ip;
let receive_port;
let send_ip;
let send_port;
let multicast;		 

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
	async onReady() {
		// Init your Adapter here
		receive_ip = this.config.receive_1 + "." + this.config.receive_2 + "." + this.config.receive_3 + "." + this.config.receive_4;
		receive_port = this.config.receive_port;
		send_ip = this.config.send_1 + "." + this.config.send_2 + "." + this.config.send_3 + "." + this.config.send_4;
		send_port = this.config.send_port;
		this.log.info("IP-Adress Receiver = : " + receive_ip);
		this.log.info("Port des Receivers = : " + receive_port);
		this.log.info("IP-Adress Sender = : " + send_ip);
		this.log.info("Port des Senders = : " + send_port);
		this.doStateCreate("global_message", "send a free multicast message", "string", "media.tts","", true);
		multicast = dgram.createSocket("udp4");
		multicast.on("listening", () => {
			const receiveaddress = multicast.address();
			multicast.addMembership(receive_ip);
			this.log.info("Multicast Client listening on " + receiveaddress.address + ":" + receiveaddress.port + "and send to " + send_ip + ":" + send_port);
		});

		multicast.on("message", (message, remote) => {
			this.log.debug("From: " + remote.address + ":" + remote.port);
			this.log.debug("Paketlaenge: " + message.length);
			this.log.debug("Inhalt der Message encrypted: " + message);
			// Hier muss die message decrypted werden denn erst dann ist JSON.parse anwendbar!!
			this.log.debug("Inhalt der Message decrypted: " + message);
			try {
				const received_data = JSON.parse(message);	// Versuch den String in ein JSON zu verwandeln
				const statename = received_data.object["device_type"] + "_" + received_data.object["mac_adress"];
				this.log.info("Data from device " + statename + " correctly received");
				this.setObjectNotExists(statename,{
					type: "device",
					common: {
						name : statename 
					},
					native: {},
				});
				// Hier holen wir uns alle releventen Informationen die in das Device-Objekt müssen und wenden extrendObject an
				const objects = Object.keys(received_data.object);
				let array = [];
				for (const i in objects){
					array.push('"' + objects[i] + '" : "' + received_data.object[objects[i]] + '"');
				}				
				array = JSON.parse("{" + array + "}"); //Fertigstellen des JSON Objekts
				const objekt = {};
				objekt.common = array;
				this.extendObject(statename, objekt, (err) => {
					if (err !== null){this.log.error("Changing alias name failed with : " + err);}
				});		

				// Hier werden die states zum Objekt kreiert 
				const stateNames = Object.keys(received_data.states);
				for (const i in stateNames){
					let writable = false;
					if (received_data.states[stateNames[i]].write === undefined){
						writable =	false;
					}
					else if (received_data.states[stateNames[i]].write === true || received_data.states[stateNames[i]].write === "true") { 
						writable =	true;
					}
					this.doStateCreate(statename + "." + stateNames[i], stateNames[i], "number", received_data.states[stateNames[i]].role,received_data.states[stateNames[i]].unit, writable);
					this.setState(statename + "." + stateNames[i], { val: received_data.states[stateNames[i]].value,ack: true, expire: (received_data["object"].interval *3) + 2 });
					if (writable === true) {
						this.subscribeStates(statename + "." + stateNames[i]);
						this.log.debug("State subscribed!: "+ statename + "." + stateNames[i]);
					}
				}
			} 
			catch (error) {
				this.log.error(error);
				this.log.error("unknown message received - please read the documentation !!!! - this was received: " + message);
			}
		});
		multicast.bind(receive_port);
		
		/*
		For every state in the system there has to be also an object of type state
		Here a simple template for a boolean variable named "testVariable"
		Because every adapter instance uses its own unique namespace variable names can"t collide with other adapters variables
		*/
		// await this.setObjectAsync("testVariable", {
		// 	type: "state",
		// 	common: {
		// 		name: "testVariable",
		// 		type: "boolean",
		// 		role: "indicator",
		// 		read: true,
		// 		write: true,
		// 	},
		// 	native: {},
		// });

		// in this template all states changes inside the adapters namespace are subscribed
		this.subscribeStates("global_message");

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
		} else {
			// The state was deleted
			this.log.debug(`state ${id} deleted`);
		}
		
			

		//@ts-ignore ack is never null
		if (state.ack === false) {
			const deviceId = id.split(".");
			const stateNameToSend = deviceId[3];
			const objekt = await this.getObjectAsync(deviceId[2]);
			this.log.debug("AsyncObject received while StateChange: " + JSON.stringify(objekt));
			const sendMessage = {
				objekt : objekt.common,
				states : {
					[stateNameToSend] : {
						value : state.val
					}
				}
			};
			// message here !
			this.transmit(JSON.stringify(sendMessage));
		}
	}

	// Function to handle state creation
	doStateCreate(device, name, type,role, unit, write){	
		this.setObjectNotExists(device, {
			type: "state",
			common: {
				name: name,
				type: type,
				role: role,
				read: true,
				write: write,
				unit: unit,
				def: 0,
			},
			native: {},
		});
	}

	transmit(message){
		multicast.send(message, 0, message.length, parseInt(send_port) ,send_ip, (err, bytes) => {
			if (err) throw err;
			this.log.info("UDP Nachricht an IP " + send_ip +" an Port "+ parseInt(send_port) + " wurde versendet! - Die Länge der Nachricht war " + message.length +" Bytes");	
		});
	}



}

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