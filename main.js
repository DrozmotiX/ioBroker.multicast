'use strict';
/*
 * Created with @iobroker/create-adapter v1.8.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const randomToken = require('random-token');
// Load your modules here, e.g.:
const dgram = require('dgram');
// const {clearTimeout} = require('timers');

// Here Global variables
let receive_ip = null, receive_port = null, send_ip = null, send_port = null, multicast = null, retry_time = null, retrymaxcount = null, device_list = null;
const mainSettings = {};
const timeout_connection = {}, timeout_state = {}, count_retry = {}, existingDevices = {}, stateSendCache = {}, messagesRetryCache = {};

class Multicast extends utils.Adapter {

	/**
	 * @param {Partial<ioBroker.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		// @ts-ignore
		super({
			...options,
			name: 'multicast',
		});
		this.on('ready', this.onReady);
		this.on('stateChange', this.onStateChange);
		this.on('unload', this.onUnload);
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		// Init your Adapter here
		this.log.info('Starting Multicast Adapter - Version 0.2.0 from 7. August 2023');
		receive_ip = String(this.config.receive_1 + '.' + this.config.receive_2 + '.' + this.config.receive_3 + '.' + this.config.receive_4);
		receive_port = Number(this.config.receive_port);
		send_ip = String(this.config.send_1 + '.' + this.config.send_2 + '.' + this.config.send_3 + '.' + this.config.send_4);
		send_port = Number(this.config.send_port);
		retrymaxcount = Number(this.config.retrymaxcount);

		retry_time = Number(this.config.retrytime);

		await this.loadMainSettings();


		// Reset all connection states to FALSE
		this.DoResetConnState();
		// Write logging of configuration values to debug log
		this.log.debug('IP-Adress Receiver = : ' + receive_ip);
		this.log.debug('Port Receivers = : ' + receive_port);
		this.log.debug('IP-Adress Transmitter = : ' + send_ip);
		this.log.debug('Port Transmitter = : ' + send_port);
		this.log.debug('Retrymax count read : ' + retrymaxcount + ' as type : ' + typeof retrymaxcount);
		this.log.debug('Retrytime read : ' + retry_time + ' as type : ' + typeof retry_time);
		// Open socket to receive multicast messages
		multicast = dgram.createSocket('udp4');
		multicast.on('listening', () => {
			const receiveaddress = multicast.address();
			multicast.addMembership(receive_ip);
			this.log.info('Multicast Client listening on ' + receiveaddress.address + ':' + receiveaddress.port + ' and send to ' + send_ip + ':' + send_port);
		});
		// Bind UDP listener to receice port
		multicast.bind(receive_port);
		this.subscribeStates('*');
		this.DoTimesync();
		// Ack on message in multicast listener
		multicast.on('message', (message, remote) => {
			// Write logging received information source
			this.log.debug('From: ' + remote.address + ':' + remote.port);
			this.log.debug('Packagelength: ' + message.length);
			this.log.debug('Content of message encrypted: ' + message);
			// To-Do : handle decryption of message
			this.log.debug('Content of message : ' + message);
			try {
				//@ts-ignore message is available from function
				const received_data = JSON.parse(message);	// Versuch den String in ein JSON zu verwandeln
				const device = received_data.i['Devicename'];
				// read array if message is related to initialisation or state update
				if (received_data.Type === 'Object') {
					// initialization
					this.log.debug('Object-Data from device ' + JSON.stringify(received_data));
					this.log.info('Object-Data for device  ' + device + ' received!');
					this.DoInitialize(received_data, device);
				} else if (received_data.Type === 'State') {

					if (received_data.msgID != null) {
						if (messagesRetryCache[received_data.msgID] != null ){
							messagesRetryCache[received_data.msgID].ack = true;
						}
					} else {
						// state update
						this.DoStateupdate(received_data, true);
					}

				} else if (received_data.Type === 'StateInterval') {
					// state update without sending ack to device
					this.DoStateupdate(received_data, false);
				} else if (received_data.Type === 'Recovery'){
					// Device Recovery
					this.DoStateRestore(received_data);
				} else if (received_data.Type === 'Heartbeat'){
					// Heartbeat
					this.DoHeartbeat(received_data);
				} else if (received_data.Type === 'Info'){
					// Info states update
					this.DoInfoStates(received_data, device, false);
				}
			} catch (error) {
				// To-Do : ensure propper error logging for wrong firmware versions
				this.log.error('ERROR: '+ error);
				this.log.error('unknown message received - please read the documentation !!!! - this was received: ' + message);
			}
		});
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			this.log.info('cleaned everything up...');
			multicast.close();
			callback();
		} catch (e) {
			callback();
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
				const deviceId = id.split('.');
				let stateNameToSend = '';
				for (let i=3; i <= deviceId.length-1; i++) {
					stateNameToSend += deviceId[i];
					if(i < (deviceId.length -1)) stateNameToSend += '.';
				}

				this.log.debug('statename: ' + stateNameToSend);

				// Get common data of object
				let object;
				if (!existingDevices[deviceId[2]] || !existingDevices[deviceId[2]].common){
					this.log.debug(`No common data cached for ${deviceId[2]}, loading common object`);
					object = await this.getObjectAsync(deviceId[2]);
				} else {
					this.log.debug(`Common data cache for ${deviceId[2]} | ${JSON.stringify(existingDevices[deviceId[2]])}`);
					object = existingDevices[deviceId[2]];
				}

				if (object !== undefined && object !== null) {

					this.log.debug('AsyncObject received while StateChange: ' + JSON.stringify(object));

					// ToDo: rebuild to handle retry logic correctly
					if (stateSendCache[deviceId[2]] == null || stateNameToSend[deviceId[2]].s == null) {
						stateSendCache[deviceId[2]] = {
							i : object.common,
							s : [{[stateNameToSend] : state.val}]
						};
					} else {
						stateSendCache[deviceId[2]].s.push({stateNameToSend : state.val});
					}

					// Buffer messages before sending to combine mu
					if (stateSendCache[deviceId[2]].timer) {clearTimeout(stateSendCache[deviceId[2]].timer); stateSendCache[deviceId[2]].timer =null;}
					stateSendCache[deviceId[2]].timer = setTimeout(()=> {
						// Send message
						this.DoTransmit(JSON.stringify(stateSendCache[deviceId[2]]));
						stateSendCache[deviceId[2]] = {};
					}, mainSettings.bufferTimeout);

					//ToDo: ensure retry specific by message ID
					// if (count_retry[id] === undefined || count_retry[id] === null) {
					// 	retry_time = this.config.retrytime !== undefined ? this.config.retrytime || 500 : 500;
					// 	this.log.info('Retry Time is set from undefined to: ' + retry_time);
					// 	count_retry[id] = 1;
					// } else if (count_retry[id] <= retrymaxcount){
					// 	retry_time = retry_time * count_retry[id];
					// 	this.log.info('Retry Time is set from count retry to: ' + retry_time);
					// } else {
					// 	// In case of error just 500ms delay
					// 	retry_time = this.config.retrytime !== undefined ? this.config.retrytime || 500 : 500;
					// 	this.log.error('ERROR: Retry Time is set from ERROR to: ' + retry_time);
					// }
					// // Start timer with retry_time to check if state is acknowledge, if not send again
					// // Clear running timer if exist
					// ( () => {
					// 	if (timeout_state[deviceId[2]]) {
					// 		clearTimeout(timeout_state[deviceId[2]]);
					// 		timeout_state[deviceId[2]] = null;
					// 	}
					// })
					// ();
					// timeout_state[deviceId[2]] = setTimeout( () => {
					// 	this.DoStateRetry(id,state,deviceId[2]);
					// 	this.log.info('State retry starts in ' + retry_time + ' ms if not ACK');
					// }, retry_time);
				}
			}
		} else {
			// The state was deleted
			this.log.debug(`state ${id} deleted`);
		}
	}

	async loadMainSettings(){

		if (this.config.bufferTimeout != null){
			mainSettings.bufferTimeout = this.config.bufferTimeout;
		} else {
			// in case of error default 50ms buffer cache
			mainSettings.bufferTimeout = 50;
		}
		// Load all settings from adapter configuration into memory


	}

	// To-Do
	// async DoStateTransmit(message){
	// }

	async DoResetConnState(){
		device_list = await this.getDevicesAsync();
		this.log.info(JSON.stringify(device_list));
		for (const i in device_list){
			//@ts-ignore : Devicename exist in Device Object, custom attribute
			this.log.debug(JSON.stringify(device_list[i].common.Devicename) + ' Connection state set to FALSE');
			//@ts-ignore : Devicename exist in Device Object, custom attribute
			this.setState(device_list[i].common.Devicename + '.Info.Connected', {val: false, ack: true, expire: 70});
		}
	}

	async DoInfoStates(received_data, device, create){
		try {
			// Check if device exists, if not request complete object
			const device_cur = await this.getObjectAsync(device);
			this.log.debug('Return of async getObject at Info channel creation: ' + JSON.stringify(device_cur));
			// In case of device not found, request complete device
			if ((device_cur === undefined || device_cur === null) && create === false) {
				this.log.info('Unknown device received, requesting all device data');
				this.DoGetDevice(received_data);
			} else {
				// Define propper naming, if hostname is empty just call it device
				//const naming = received_data.i['Hostname'] || 'Device';
				const naming = received_data.i['Hostname'] || 'Device';
				// Create Device objekt and info channel only when needed
				if (create === true) {
					await this.setObjectNotExistsAsync(device,{
						type: 'device',
						common: {
						//	name : received_data.c['Hostname'].v
							name : naming
						},
						native: {},
					});
					// Create info channel
					await this.createChannelAsync(device,'Info');
				}
				// Update Device name
				await this.extendObjectAsync(device,{
					common: {
						name : naming
					},
				});
				// Read all device related information and write into object with extend object function
				const objects = Object.keys(received_data.i);
				const array = {};
				const object = {};
				for (const i in objects){
					// Prepare values to be extended in instance object
					array[objects[i]] = received_data.i[objects[i]];
					this.log.debug('Contain of array for info in device loop : ' + JSON.stringify(array));
					// Info channel is always read only!
					const writable = false;
					this.log.debug('"' + objects[i] + '" : "' + received_data.i[objects[i]] + '"');
					// Check if state contains min and max value
					const min = this.DoDefineMin(received_data.i[objects[i]]);
					const max = this.DoDefineMax(received_data.i[objects[i]]);
					if (create === true) {await this.DoStateCreate(device + '.Info.' + objects[i], objects[i] , 'string', received_data.i[objects[i]].r,'', writable, min, max);}
					// Verify if value contains an object, if yes set expire time otherwise just set value (we should check expire is in object too, not only check if is an object)
					if (typeof received_data.i[objects[i]] === 'object'){
						await this.setStateAsync(device + '.Info.' + objects[i], { val: received_data.i[objects[i]].val,ack: true, expire: received_data.i[objects[i]].expire});
					} else {
						await this.setStateAsync(device + '.Info.' + objects[i], { val: received_data.i[objects[i]],ack: true});
					}
					object.common = array;
				}
				this.extendObject(device, object, (err) => {
					if (err !== null){this.log.error('Changing alias name failed with : ' + err);}
				});
				// Send confirmation message
				// Add TimeStamp to common object in info channel
				if (create === false) {
					object.common['ts'] = await this.DoGetcurrentTime;
					const confirm = {
						i : object.common,
						Type : 'Info-OK'
					};
					this.log.info('Device ' + device + ' successfully initiated (Info-OK)');
					this.DoTransmit(JSON.stringify(confirm));
				}
			}
		} catch (error) {
			this.log.error('ERROR: ' + error);
		}
	}

	// async DoStateRetry(id, state, device){
	// 	// Get data from state and verify ACK value
	// 	const ack_check = await this.getStateAsync(id);
	// 	if (!ack_check) return;
	// 	// Check if value is acknowledged, if not resend same message again
	// 	if (ack_check.ack === false && (count_retry[id] === undefined || count_retry[id] <= retrymaxcount || count_retry[id] === null) ){
	// 		// When counter is undefined, start at 1
	// 		if (count_retry[id] === undefined || count_retry[id] === null){
	// 			count_retry[id] = 1;
	// 			this.log.warn('State change for device : ' + id + ' not aknowledged, resending information in count retry undefined');
	// 			// this.onStateChange(id,state);
	// 		} else if (count_retry[id] < retrymaxcount ){
	// 			count_retry[id] = count_retry[id] + 1;
	// 			this.log.warn('State change for device : ' + id + ' not aknowledged, resending information attempt : ' + count_retry[id]);
	// 			// this.onStateChange(id,state);
	// 		// Stop resending message when maximum counter is reached and set connection state to false
	// 		} else if (count_retry[id] === retrymaxcount){
	// 			this.log.error('Maximum retry count reached, device : ' + device + ' not connected !');
	// 			this.setState(this.namespace + '.' + device + '.Info.Connected',{ val: false, ack: true});
	// 			count_retry[id] = 0;
	// 		}
	// 	// Reset counter to 0 for next run
	// 	} else if (ack_check.ack === true) {
	// 		// Stop retrying and switch connection state of device to disabled
	// 		this.log.info('State change of device : ' + id + ' aknowledged');
	// 		count_retry[id] = null;
	// 	}
	// }

	async DoInitialize(received_data, device){
		// Create connection object and set connection to true
		await this.setObjectNotExistsAsync(received_data.i['Devicename'] + '.Info.Connected', {
			type: 'state',
			common: {
				name: 'online',
				type: 'boolean',
				role: 'indicator.connection',
				read: true,
				write: false,
				def: false,
			},
			native: {},
		});

		await this.setStateAsync(received_data.i['Devicename'] + '.Info.Connected',{ val: true, ack: true, expire: 70});
		// Create info channels and write values in object
		this.log.debug('Create info changes with data : ' +  JSON.stringify(received_data) + ' and device name : ' + device);
		await this.DoInfoStates(received_data, device, true);
		try {
			// Read all configuration related information and write into object with extend objection function
			// To-Do :  Implement cache for case JSON does not contain configuration data
			const config = Object.keys(received_data.c);
			// Create config channel
			await this.createChannelAsync(device, 'Config');
			for (const i in config){
				// Config channel is always writable
				const writable = true;
				// Define if state must be part of channel and create state name
				let stateCreateName = device + '.Config.' + config[i];
				this.log.debug('stateCreateName before if : ' + stateCreateName);
				if (received_data.c[config[i]].c === undefined){
					// do nothing
				}
				else {
					stateCreateName = device + '.Config.' + received_data.c[config[i]].c + '.' + config[i];
				}
				this.log.debug('stateCreateName after if : ' + stateCreateName);
				// Check if state contains min and max values
				const min = this.DoDefineMin(received_data.c[config[i]]);
				const max = this.DoDefineMax(received_data.c[config[i]]);
				this.log.debug('"' + config[i] + '" : "' + received_data.c[config[i]] + '"');
				// create state and update value
				await this.DoStateCreate(stateCreateName, config[i] , received_data.c[config[i]].t, received_data.c[config[i]].r,received_data.c[config[i]].u, writable, min, max);
				await this.setStateAsync(stateCreateName, { val: received_data.c[config[i]].v, ack: true});
				// if state has writable flag subscribe on changes
				this.Dosubscribe(stateCreateName, writable);
			}
		} catch (error) {
			// No channel data present, skip
		}
		/*
		// Create states for all values received in JSON ==> Old code support first versions of firmware
		// To-Do :  Implement cache for case JSON does not contain state data
		try {
			const stateNames = Object.keys(received_data.s); // Old funktion should never be used!
			for (const i in stateNames){
				const writable = await this.DoDefineWritable(received_data.s[stateNames[i]]);
				// Define if state must be part of channel and create state name
				let stateCreateName = device + '.' + stateNames[i];
				this.log.debug('stateCreateName before if : ' + stateCreateName);
				if (received_data.s[stateNames[i]].c === undefined){
					// do nothing
				}
				else {
					// Create state in info channel
					await this.createChannelAsync(device, received_data.s[stateNames[i]].c);
					stateCreateName = device + '.' + received_data.s[stateNames[i]].c + '.' + stateNames[i];
				}
				this.log.debug('stateCreateName after if : ' + stateCreateName);
				// Check if state contains min and max value
				const min = await this.DoDefineMin(received_data.s[stateNames[i]]);
				const max = await this.DoDefineMax(received_data.s[stateNames[i]]);
				// create state and update value
				await this.DoStateCreate(stateCreateName, stateNames[i], received_data.s[stateNames[i]].t, received_data.s[stateNames[i]].r,received_data.s[stateNames[i]].u, writable, min, max);
				await this.setStateAsync(stateCreateName, { val: received_data.s[stateNames[i]].v,ack: true});
				// if state has writable flag subscribe on changes
				this.Dosubscribe(stateCreateName, writable);
			}
		} catch (error) {
			// No state data received, skip=
		}*/

		// Create states for all values received in JSON
		// To-Do :  Implement cache for case JSON does not contain state data
		// New routine for states comes as a complete string (ss) ------ (Replaces received_data.s)
		try {
			const StringifiedStateNames = received_data.ss;
			for (const i in StringifiedStateNames) {
				const splittedDevice = i.split('.');
				if (splittedDevice.length > 1) {
					let channelCreateName = device;
					for (let x = 0; x <= (splittedDevice.length -2); x++) {
						channelCreateName += '.' + splittedDevice[x];
						await this.setObjectNotExistsAsync(channelCreateName, {
							type: 'channel',
							common: {
								name: splittedDevice[x],
							},
							native: {},
						});
					}
				}
				if (splittedDevice[splittedDevice.length-1] === 'Hostname') {
					const object = {
						common : {
							name : StringifiedStateNames[i].v,
						}
					};
					this.log.debug('Renaming : ' + JSON.stringify(object));
					try {
						await this.extendObjectAsync(device, object);
					} catch (error){
						this.log.error('Changing Hostname failed with : ' + error);
					}
				}
				const writable = this.DoDefineWritable(StringifiedStateNames[i]);
				const stateCreateName = device + '.' + i;

				// Trow error in case no states are provided in message
				let comm_states = 'test';
				try {
					comm_states =  StringifiedStateNames[i].states || null;
					this.log.debug('States content : ' + comm_states);
				} catch (error) {
					this.log.error('Nachricht enthält keine states : ' + error);
				}

				await this.DoStateCreate(stateCreateName, splittedDevice[splittedDevice.length - 1], StringifiedStateNames[i].t, StringifiedStateNames[i].r, StringifiedStateNames[i].u, writable, null, null , comm_states);
				this.log.debug('Value for in state creation : ' + StringifiedStateNames[i].v);
				if (StringifiedStateNames[i].e !== undefined && StringifiedStateNames[i].e !== null ){
					this.log.debug('State ' + stateCreateName + ' with value ' + StringifiedStateNames[i].v + ' and expire ' +  StringifiedStateNames[i].e);
					await this.setStateAsync(stateCreateName, { val: StringifiedStateNames[i].v ,ack: true, expire: StringifiedStateNames[i].e});
				} else {
					this.log.debug('State ' + stateCreateName + ' with value ' + StringifiedStateNames[i].v);
					await this.setStateAsync(stateCreateName, { val: StringifiedStateNames[i].v,ack: true});
				}
				// if state has writable flag subscribe on changes
				this.Dosubscribe(stateCreateName, writable);
			}
		} catch (error) {
			// write error message to log
			this.log.error('ERROR: ' + error);
		}
		// Add TimeStamp to common object in info channel
		const object = {};
		object.common = received_data.i;
		object.common['ts'] = await this.DoGetcurrentTime;
		const confirm = {
			i : object.common,
			Type : 'synced'
		};
		this.log.info('Device ' + device + ' successfully synced');
		this.DoTransmit(JSON.stringify(confirm));
	}

	// function to handle state updates
	async DoStateupdate(received_data, confirm){
		const stateNames = Object.keys(received_data.s);
		if (await this.DoCheckConnection(received_data) === false){
			return;
		}
		const object = await this.getObjectAsync(received_data.i['Devicename']);
		this.log.debug('Return of async getObject : ' + JSON.stringify(object));
		// In case of device not found, request complete device
		if (object === undefined || object === null) {
			this.DoGetDevice(received_data);
		} else {
			for (const i in stateNames){
				const statename = this.namespace + '.' + stateNames[i];
				this.log.debug('Statename to update : ' + statename + ' with value : ' + received_data.s[stateNames[i]]);
				const deviceId = statename.split('.');
				this.log.debug('Statename to send : ' + deviceId[2]);
				this.log.debug('Type of state : ' + typeof received_data.s[stateNames[i]]);
				this.DoState_change(statename, received_data.s[stateNames[i]]);
			}
			// Add TimeStamp to common object in info channel
			object.common['ts'] = (new Date().getTime());
			this.log.debug('Message confirm ' + confirm );
			if (confirm === true){
				const confirm = {
					i : object.common,
					s : received_data.s,
					Type : 'OK'
				};
				this.DoTransmit(JSON.stringify(confirm));
			}
		}
	}

	// Function to handle state creation
	async DoStateCreate(device, name, type, role, unit, write, min, max, states_value){

		const common = {
			name: name,
			type: type,
			role: role,
			read: true,
			write: write,
			unit: unit,
			def: 0
		};

		if (min != null) {
			common.min = min;
		}

		if (max != null) {
			common.max = max;
		}

		if (states_value != null) {
			common.states = states_value;
		}

		await this.setObjectNotExistsAsync(device, {
			type: 'state',
			common,
			native: {},
		});

	}

	DoState_change (state, value) {
		if (typeof value === 'object') {
			this.log.debug('Update state with expire : ' + value.expire);
			this.setStateAsync(state, { val: value.val, ack: true, expire: value.expire});
		} else {
			this.log.debug('Update state without expire');
			this.setState(state, { val: value,ack: true});
		}
	}

	DoDefineMin (source) {
		this.log.debug('Raw min function : ' + JSON.stringify(source));
		this.log.debug('Min : ' + JSON.stringify(source.min));
		let min = '';
		if (source.min != null){
			min = source.min;
		}
		return min;
	}

	DoDefineMax (source) {
		this.log.debug('Raw max function : ' + JSON.stringify(source));
		this.log.debug('Max : ' + JSON.stringify(source.max));
		let max = '';
		if (source.max != null){
			max = source.max;
		}
		return max;
	}

	DoDefineWritable(source){
		if (!source) return false;
		if (!source.w){
			return false;
		}
		else if (source.w === true || source.w === 'true') {
			return true;
		}

	}

	Dosubscribe (statename, writable){
		if (writable === true) {
			this.subscribeStates(statename);
			this.log.debug('State subscribed!: '+ statename);
		}
	}

	DoTimesync(){
		// In case of error, use 1 minute as default
		let interval;
		if (this.config.Time_Sync !== undefined && this.config.Time_Sync !== null){
			interval = (this.config.Time_Sync * 1000);
		} else {
			this.log.error('Error reading time-interval settings, using value of 1 minute');
			interval = 60000;
		}
		setInterval(() => {
			const TimeStamp = (new Date().getTime());
			const UnixTime = {
				i : {
					ts : TimeStamp
				},
				Type : 'TimeSync'
			};
			this.DoTransmit(JSON.stringify(UnixTime));
			this.log.info('TimeSync transmitted');
		}, interval);
	}

	async DoStateRestore(received_data){
		const device = received_data.i['Devicename'];
		// Set connected flag
		this.setState(received_data.i['Devicename'] + '.Info.Connected',{ val: true, ack: true, expire: 70});
		const object = await this.getObjectAsync(device);
		this.log.debug('Return of async getObject : ' + JSON.stringify(object));
		// In case of device not found, request complete device
		if (object === undefined || object === null) {
			this.log.info('Unknown device received! Requesting device object');
			this.DoGetDevice(received_data);
		} else {
			this.log.info('Recovering device : ' + device);
			const states = await this.getStatesOfAsync(device);
			const state_values = {};
			for (const i in states){
				const tmp = states[i]._id;
				const deviceId = tmp.split('.');
				if (deviceId[3] !== 'Info'){
					let stateNameToSend = '';
					for (let i=3; i <= deviceId.length-1; i++) {
						stateNameToSend += deviceId[i];
						if(i < (deviceId.length -1)) stateNameToSend += '.';
					}
					const value = await this.getStateAsync(states[i]._id);
					this.log.debug('Received data from getstate in recovery function : ' + JSON.stringify(value));
					if (value !== null && value !== undefined){
						this.log.debug('Statename to recover : ' + stateNameToSend + ' with value : ' + value.val);
						state_values[stateNameToSend] = value.val;
					}
					this.log.debug('tmp_array content : ' + JSON.stringify(state_values));
				}
			}
			// Add current timestamp to object
			this.log.info('State recovery values : ' + JSON.stringify(state_values));
			object.common['ts'] = (new Date().getTime());
			const arraytosend = {
				i : object.common,
				s : state_values,
				Type : 'Recovery-Data'
			};
			this.log.debug('Recovery data values : ' + JSON.stringify(arraytosend));
			this.DoTransmit(JSON.stringify(arraytosend));
		}
	}

	async DoHeartbeat(received_data) {
		this.log.debug('Hartbeat Message received' + JSON.stringify(received_data));
		this.log.debug(received_data.i['Devicename']);
		if (await this.DoCheckConnection(received_data) === false){return;}
		const object = await this.getObjectAsync(received_data.i['Devicename']);
		this.log.debug('Device object data in Heartbeat: ' + JSON.stringify(object));
		if (object === undefined || object === null) {
			this.DoGetDevice(received_data);
		} else {
			this.setState(received_data.i['Devicename'] + '.Info.Connected',{ val: true, ack: true, expire: 70});
			this.DoStateupdate(received_data, false);
			(function () {
				if (timeout_connection[received_data.i['Devicename']]) {
					clearTimeout(timeout_connection[received_data.i['Devicename']]); timeout_connection[received_data.i['Devicename']] = null;}
			})();
			timeout_connection[received_data.i['Devicename']] = setTimeout( () => {
				this.setState(received_data.i['Devicename'] + '.Info.Connected',{ val: false, ack: true});
			}, 65000);
		}
	}

	DoGetcurrentTime(){
		return (new Date().getTime());
	}

	DoGetDevice(received_data){
		// Add TimeStamp to common object in info channel
		received_data.i['ts'] = (new Date().getTime());
		this.log.warn('Unknown device received, requesting device object');
		const sendMessage = {
			i : received_data.i,
			Type : 'sync'
		};
		this.DoTransmit(JSON.stringify(sendMessage));
	}

	async DoCheckConnection (received_data){
		let connection = false;
		// Check if current connection state = FALSE, if yes send recovery data
		const con_state = await this.getStateAsync(received_data.i['Devicename'] + '.Info.Connected');
		if (con_state != null) {
			if (con_state.val === false){
				this.DoStateRestore(received_data);
			} else {
				connection = true;
			}
		} else {
			this.DoGetDevice(received_data);
		}
		return connection;
	}


	DoTransmit(message, msgID){

		// Add/change timestamp to message
		message['ts'] = (new Date().getTime());

		// Add unique messageID if not yet present
		if (!msgID) {
			msgID = randomToken(16);
			message.msgID = msgID;
			messagesRetryCache[msgID] = {};
			messagesRetryCache[msgID].ack = false;
			messagesRetryCache[msgID].count = 0;
		}

		if (messagesRetryCache[msgID].ack === false && messagesRetryCache[msgID].count < retrymaxcount + 1) {
			messagesRetryCache[msgID].count = messagesRetryCache[msgID].count + 1;
			// Send multicast message
			multicast.send(message, 0, message.length, parseInt(send_port) ,send_ip, (err, bytes) => {
				if (err) throw err;
				this.log.debug('Multicast Message content : ' + message);
				this.log.debug('Multicast Message to IP ' + send_ip + ' on Port '+ parseInt(send_port) + ' transmitted! Length of message was ' + message.length + ' with ' + bytes + ' bytes ');
			});

			// Buffer messages before sending to combine mu
			if (messagesRetryCache[msgID].timer) {clearTimeout(messagesRetryCache[msgID].timer); messagesRetryCache[msgID].timer =null;}
			messagesRetryCache[msgID].timer = setTimeout(()=> {
				// Send message
				this.DoTransmit(JSON.stringify(message, msgID));
			}, retry_time * messagesRetryCache[msgID].count);
		} else if (messagesRetryCache[msgID].ack === true) {
			// No action required, message already acknowledged

		} else {
			this.log.error(`Device ${message.common.id} not response to message ${msgID}`)
			this.setState(`${message.common.id}.Info.Connected`,{ val: false, ack: true});
		}
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
