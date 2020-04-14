'use strict';

/*
 * Created with @iobroker/create-adapter v1.8.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load your modules here, e.g.:
const dgram = require('dgram');

// Here Global variables
let receive_ip = null, receive_port = null, send_ip = null, send_port = null, multicast = null, retry_time = null, retrymaxcount = null, device_list = null;
const timeout_connection = {}, timeout_state = {}, count_retry = {};

class Multicast extends utils.Adapter {

	/**
	 * @param {Partial<ioBroker.AdapterOptions>} [options={}]
	 */
	constructor(options) {
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
	onReady() {
		// Init your Adapter here
		receive_ip = this.config.receive_1 + '.' + this.config.receive_2 + '.' + this.config.receive_3 + '.' + this.config.receive_4;
		receive_port = this.config.receive_port;
		send_ip = this.config.send_1 + '.' + this.config.send_2 + '.' + this.config.send_3 + '.' + this.config.send_4;
		send_port = this.config.send_port;
		retry_time = this.config.retrytime;
		retrymaxcount = this.config.retrymaxcount;
		// Reset all connection states to FALSE
		this.DoResetConnState();

		// Write logging of configuration values in silly mode
		this.log.debug('IP-Adress Receiver = : ' + receive_ip);
		this.log.debug('Port Receivers = : ' + receive_port);
		this.log.debug('IP-Adress Transmitter = : ' + send_ip);
		this.log.debug('Port Transmitter = : ' + send_port);
		this.log.debug('Retrymax count read : ' + retrymaxcount + ' as type : ' + typeof retrymaxcount);

		// Create state to send global multicast message
		// this.doStateCreate('global_message', 'send a free multicast message', 'string', 'media.tts','', true);
		// this.subscribeStates('global_message');

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
				if (received_data.Type == 'Object') {
					// initialization
					this.log.debug('Data from device ' + JSON.stringify(received_data));
					this.log.info('Data for device  ' + device + ' received, initializing device');
					this.DoInitialize(received_data, device);
				
				} else if (received_data.Type == 'State') {
					// state update
					this.DoStateupdate(received_data, true);
					// this.setState(received_data.i['Devicename'] + '.Info.Connected',{ val: true, ack: true});

				} else if (received_data.Type == 'StateInterval') {
					// state update
					this.DoStateupdate(received_data, false);
					// this.setState(received_data.i['Devicename'] + '.Info.Connected',{ val: true, ack: true});

				} else if (received_data.Type == 'Recovery'){
					// state update
					this.DoStateRestore(received_data);

				} else if (received_data.Type == 'Heartbeat'){
					// state update
					this.DoHeartbeat(received_data);
					
				} else if (received_data.Type == 'Info'){
					// state update
					this.DoInfoStates(received_data, device, false);
				}

			} catch (error) {
				// To-Do : ensure propper error logging for wrong firmware versions
				this.log.error(error);
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

				const objekt = await this.getObjectAsync(deviceId[2]);
				this.log.debug('Return of async getObject : ' + JSON.stringify(objekt));
				if (objekt !== undefined && objekt !== null) {
					this.log.debug('AsyncObject received while StateChange: ' + JSON.stringify(objekt));
					// Add TimeStamp to common object in info channel
					objekt.common['ts'] = (new Date().getTime());
					const sendMessage = {
						i : objekt.common,
						s : {[stateNameToSend] : state.val}				
					};

					// Send message
					this.DoTransmit(JSON.stringify(sendMessage));

					// New send message routine (queuing)
					// this.DoStateTransmit(sendMessage);

					// Define wait time for retry
					if (count_retry[id] === undefined || count_retry[id] === null) {

						retry_time = 500;

					} else if (count_retry[id] <= retrymaxcount){

						retry_time = 500 * count_retry[id];

					} else {
						// In case of error just 500ms delay
						retry_time = 500;
					}

					// Start timer of 500 ms to check if state is aknowledge, if not send again
					// Clear running timer if exist
					( () => {if (timeout_state[deviceId[2]]) {clearTimeout(timeout_state[deviceId[2]]); timeout_state[deviceId[2]] = null;}})();
					timeout_state[deviceId[2]] = setTimeout( () => {
						this.DoStateRetry(id,state,deviceId[2]);
					}, retry_time);
				}
			}		
		} else {
			// The state was deleted
			this.log.debug(`state ${id} deleted`);
		}
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

				// Read all device related information and write into object with extend objection function
				const objects = Object.keys(received_data.i);
				const array = {};
				const objekt = {};

				for (const i in objects){
					// Prepare values to be extended in instance object
					array[objects[i]] = received_data.i[objects[i]];
					this.log.debug('Contain of array for info in device loop : ' + JSON.stringify(array));

					// Info channel is always read only, set hardcoded
					const writable = false;

					this.log.debug('"' + objects[i] + '" : "' + received_data.i[objects[i]] + '"');

					// Check if state must contain min and max value
					const min = await this.DoDefineMin(received_data.i[objects[i]]);
					const max = await this.DoDefineMax(received_data.i[objects[i]]);

					// tdoStateCreate(device, name, type,role, unit, write)
					if (create === true) {await this.DoStateCreate(device + '.Info.' + objects[i], objects[i] , 'number', received_data.i[objects[i]].r,'', writable, min, max);}
					
					// Verify if value contains an object, if yes set expire time otherwise just set value
					if (typeof received_data.i[objects[i]] === 'object'){
						await this.setStateAsync(device + '.Info.' + objects[i], { val: received_data.i[objects[i]].val,ack: true, expire: received_data.i[objects[i]].expire});
					} else {
						await this.setStateAsync(device + '.Info.' + objects[i], { val: received_data.i[objects[i]],ack: true});
					}

					objekt.common = array;
			
				}

				this.extendObject(device, objekt, (err) => {
					if (err !== null){this.log.error('Changing alias name failed with : ' + err);}
				});

				// Send confirmation message

				// Add TimeStamp to common object in info channel
				if (create === false) {
					objekt.common['ts'] = await this.DoGetcurrentTime;
					const confirm = {
						i : objekt.common,
						Type : 'Info-OK'				
					};
					// message here !
					this.log.info('Device ' + device + ' successfully initiated');
					this.DoTransmit(JSON.stringify(confirm));
				}

			}

		} catch (error) {
			this.log.error(error);
		}

	}

	async DoStateRetry(id, state, device){
		// Get data from state and verify ACK value
		const ack_check = await this.getStateAsync(id);
		if (!ack_check) return;

		// Check if value is aknowledged, if not resend same message again
		if (ack_check.ack === false && (count_retry[id] === undefined || count_retry[id] <= retrymaxcount || count_retry[id] === null) ){

			// When counter is undefined, start at 1
			if (count_retry[id] === undefined || count_retry[id] === null){
				count_retry[id] = 1;
				this.log.warn('State change for device : ' + id + ' not aknowledged, resending information');
				this.onStateChange(id,state);

			// When counter is < 5 add + 1 to counter
			} else if (count_retry[id] < retrymaxcount ){
				count_retry[id] = count_retry[id] + 1;
				this.log.warn('State change for device : ' + id + ' not aknowledged, resending information');
				this.onStateChange(id,state);

			// Stop resending message when maximum counter is reached and set connection state to false
			} else if (count_retry[id] === retrymaxcount){
				this.log.error('Maximum retry count reached, device : ' + device + ' not connected !');
				this.setState(this.namespace + '.' + device + '.Info.Connected',{ val: false, ack: true});
				count_retry[id] = 0;
			} 

		// Reset counter to 0 for next run
		} else if (ack_check.ack === true) { 
			// Stop retrying and switch connection state of device to disabled
			this.log.debug('State change of device : ' + id + ' aknowledged');
			count_retry[id] = null;
		}
	}

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
		this.log.debug('Create info channges with data : ' +  JSON.stringify(received_data) + ' and device name : ' + device);
		await this.DoInfoStates(received_data, device, true);
		
		try {
			// Read all configuration related information and write into object with extend objection function
			// To-Do :  Implement cache for case JSON does not contain configuration data
			const config = Object.keys(received_data.c);

			// Create config channel
			await this.createChannelAsync(device, 'Config');
			for (const i in config){
				// Config channel is always writable, set hardcoded
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
				
				// Check if state must contain min and max value
				const min = await this.DoDefineMin(received_data.c[config[i]]);
				const max = await this.DoDefineMax(received_data.c[config[i]]);

				this.log.debug('"' + config[i] + '" : "' + received_data.c[config[i]] + '"');

				// create state and update value 
				await this.DoStateCreate(stateCreateName, config[i] , received_data.c[config[i]].t, received_data.c[config[i]].r,received_data.c[config[i]].u, writable, min, max);
				await this.setStateAsync(stateCreateName, { val: received_data.c[config[i]].v, ack: true});

				// if state has writable flag yes, subscribe on changes
				this.Dosubscribe(stateCreateName, writable);
			}						
		} catch (error) {
			// No channel data present, skip
		}

		// Create states for all values received in JSON
		// To-Do :  Implement cache for case JSON does not contain state data
		try {
			const stateNames = Object.keys(received_data.s);
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

				// Check if state must contain min and max value
				const min = await this.DoDefineMin(received_data.s[stateNames[i]]);
				const max = await this.DoDefineMax(received_data.s[stateNames[i]]);

				// create state and update value 
				await this.DoStateCreate(stateCreateName, stateNames[i], received_data.s[stateNames[i]].t, received_data.s[stateNames[i]].r,received_data.s[stateNames[i]].u, writable, min, max);
				
				// this.log.debug('Value of intervall : ' + received_data.c['Interval_Object'].v);
				// this.setState(stateCreateName, { val: received_data.s[stateNames[i]].v,ack: true, expire: (received_data.c['Interval_Object'].v *3) + 2 });
				await this.setStateAsync(stateCreateName, { val: received_data.s[stateNames[i]].v,ack: true});

				// if state has writable flag true, subscribe on changes
				this.Dosubscribe(stateCreateName, writable);
			}

		} catch (error) {
			// No state data received, skip=
		}

		// New routine for StateAsString (ss) ---------------------------------------------------------------------------------------------------------------------------------------------------------
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
					const objekt = { common : {
						name : StringifiedStateNames[i].v,
					}};
					this.log.debug('Renaming : ' + JSON.stringify(objekt));
					await this.extendObjectAsync(device, objekt, (err) => {
						if (err !== null){this.log.error('Changing alias name failed with : ' + err);}
					});
				}
				const writable = await  this.DoDefineWritable(StringifiedStateNames[i]);
				const stateCreateName = device + '.' + i;

				let comm_states = 'test';
				try {
					comm_states =  StringifiedStateNames[i].states || null;
					this.log.debug('States content : ' + comm_states);				
				} catch (error) {
					this.log.error('Hast scheisse gebaut : ' + error);
					
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

				// if state has writable flag true, subscribe on changes
				this.Dosubscribe(stateCreateName, writable);
			}
		} catch (error) {
			// write error message to log
			this.log.error(error);
		}

		// Add TimeStamp to common object in info channel
		const objekt = {};
		objekt.common = received_data.i;
		objekt.common['ts'] = await this.DoGetcurrentTime;
		const confirm = {
			i : objekt.common,
			Type : 'synced'				
		};
		// message here !
		this.log.info('Device ' + device + ' successfully initiated');
		this.DoTransmit(JSON.stringify(confirm));

	}

	// function to handle state updates
	async DoStateupdate(received_data, confirm){
		const stateNames = Object.keys(received_data.s);
		// const exp_timer = await this.getStateAsync(this.namespace + '.Config.System.Interval_Measure');
		// this.log.debug('Configured interval : ' + this.namespace + ' || ' + exp_timer);

		if (await this.DoCheckConnection(received_data) === false){return;}

		const objekt = await this.getObjectAsync(received_data.i['Devicename']);
		this.log.debug('Return of async getObject : ' + JSON.stringify(objekt));

		// In case of device not found, request complete device
		if (objekt === undefined || objekt === null) {

			this.DoGetDevice(received_data);
		
		} else {

			for (const i in stateNames){
				const statename = this.namespace + '.' + stateNames[i];
				this.log.debug('Statename to update : ' + statename + ' with value : ' + received_data.s[stateNames[i]]);
		
				const deviceId = statename.split('.');
				this.log.debug('Statename to send : ' + deviceId[2]);
				
				this.log.debug('Type of state : ' + typeof received_data.s[stateNames[i]]);

				this.DoState_change(statename, received_data.s[stateNames[i]]);

				// if (typeof received_data.s[stateNames[i]] === 'object') {
				// 	this.log.debug('Update state with expire : ' + received_data.s[stateNames[i]].expire);
				// 	await this.setStateAsync(statename, { val: received_data.s[stateNames[i]].val, ack: true, expire: received_data.s[stateNames[i]].expire});
				// } else {
				// 	this.log.debug('Update state without expire');
				// 	this.setState(statename, { val: received_data.s[stateNames[i]],ack: true});
				// }

			}				
			// Add TimeStamp to common object in info channel
			objekt.common['ts'] = (new Date().getTime());
			this.log.debug('Message confirm ' + confirm );
			if (confirm === true){
				const confirm = {
					i : objekt.common,
					s : received_data.s,
					Type : 'OK'				
				};
				// message here !

				this.DoTransmit(JSON.stringify(confirm));
				
			}
		}
	}

	// Function to handle state creation
	async DoStateCreate(device, name, type,role, unit, write,min, max, states_value){	
		
		await this.setObjectNotExistsAsync(device, {
			type: 'state',
			common: {
				name: name,
				type: type,
				role: role,
				read: true,
				write: write,
				unit: unit,
				def: 0
			},
			native: {},
		});

		if (min !== null) {
			this.extendObjectAsync(device, {
				common: {
					min: min,
				}
			});
		}

		if (max !== null) {
			this.extendObjectAsync(device, {
				common: {
					max: max,
				}
			});	
		}

		if (states_value !== null) {

			this.extendObjectAsync(device, {
				common: {
					states : states_value,
				}
			});
			
		}

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
		if (source.min !== undefined){
			min = source.min;
		}
		return min;

	}

	DoDefineMax (source) {
		this.log.debug('Raw max function : ' + JSON.stringify(source));
		this.log.debug('Min : ' + JSON.stringify(source.max));
		let max = '';
		if (source.min !== undefined){
			max = source.max;
		}
		return max;
	}

	DoDefineWritable(source){
		let writable = false;
		if (source.w === undefined){
			writable = false;
		}
		else if (source.w === true || source.w === 'true') { 
			writable =	true;
		}
		return writable;
	}

	Dosubscribe (statename, writable){

		if (writable === true) {
			this.subscribeStates(statename);
			this.log.debug('State subscribed!: '+ statename);
		}

	}

	DoTimesync(){
		// In case of error, use 10 minutes as default
		let intervall;
		if (this.config.Time_Sync !== undefined && this.config.Time_Sync !== null){
			intervall = (this.config.Time_Sync * 1000);
		} else {
			this.log.error('Error reading time-intervall settings, using value of 1 minute');
			intervall = 60000;
		}
		setInterval(() => {
			const TimeStamp = (new Date().getTime());
			const UnixTime = {
				i : {
					ts : TimeStamp
				},
				Type : 'TimeSync'				
			};
			// message here !
			this.DoTransmit(JSON.stringify(UnixTime));

		}, intervall);

	}

	async DoStateRestore(received_data){
		const device = received_data.i['Devicename'];
		// Set connected flag
		this.setState(received_data.i['Devicename'] + '.Info.Connected',{ val: true, ack: true, expire: 70});
		const objekt = await this.getObjectAsync(device);
		this.log.debug('Return of async getObject : ' + JSON.stringify(objekt));

		// In case of device not found, request complete device
		if (objekt === undefined || objekt === null) {
			this.log.info('Unknown device received, requesting all device data');
			this.DoGetDevice(received_data);
		
		} else {

			this.log.info('Restore function triggered for device : ' + device);
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
					this.log.debug('Received data from getstate in restore function : ' + JSON.stringify(value));

					if (value !== null && value !== undefined){
						this.log.debug('Statename to recover : ' + stateNameToSend + ' with value : ' + value.val);
						state_values[stateNameToSend] = value.val;
					}
					this.log.debug('tmp_array content : ' + JSON.stringify(state_values));
				}
			}
			// Add current timestamp to object
			this.log.info('State recovery values : ' + JSON.stringify(state_values));
			objekt.common['ts'] = (new Date().getTime());
			const arraytosend = {
				i : objekt.common,
				s : state_values,
				Type : 'Recovery-Data'
			};
			this.log.debug('Recovery data values : ' + JSON.stringify(arraytosend));
			// message here !
			this.DoTransmit(JSON.stringify(arraytosend));
		}
	}

	async DoHeartbeat(received_data) {
		this.log.debug('Hartbeat Message received' + JSON.stringify(received_data));
		this.log.debug(received_data.i['Devicename']);
		
		if (await this.DoCheckConnection(received_data) === false){return;}

		const objekt = await this.getObjectAsync(received_data.i['Devicename']);
		this.log.debug('Get Device Objekt data : ' + JSON.stringify(objekt));
		if (objekt === undefined || objekt === null) {

			this.DoGetDevice(received_data);
		
		} else {

			this.setState(received_data.i['Devicename'] + '.Info.Connected',{ val: true, ack: true, expire: 70});
			this.DoStateupdate(received_data, false);
			(function () {if (timeout_connection[received_data.i['Devicename']]) {clearTimeout(timeout_connection[received_data.i['Devicename']]); timeout_connection[received_data.i['Devicename']] = null;}})();
			timeout_connection[received_data.i['Devicename']] = setTimeout( () => {
				this.setState(received_data.i['Devicename'] + '.Info.Connected',{ val: false, ack: true});
			}, 65000);

		}

	}

	DoGetcurrentTime(){
		const time = (new Date().getTime());
		return time;
	}

	DoGetDevice(received_data){

		// Add TimeStamp to common object in info channel
		received_data.i['ts'] = (new Date().getTime());
		this.log.warn('Unknown device received, requesting all device data');
		const sendMessage = {
			i : received_data.i,
			Type : 'sync'				
		};
		// message here !
		this.DoTransmit(JSON.stringify(sendMessage));

	}

	async DoCheckConnection (received_data){
		let connection = false;

		// Check if current connection state = FALSE, if yes send recovery data
		const con_state = await this.getStateAsync(received_data.i['Devicename'] + '.Info.Connected');

		if (con_state !== undefined && con_state !== null) {
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

	// Send UDP message
	DoTransmit(message){
		multicast.send(message, 0, message.length, parseInt(send_port) ,send_ip, (err, bytes) => {
			if (err) throw err;
			this.log.debug('Multicast Message content : ' + message);
			this.log.debug('Multicast Message to IP ' + send_ip + ' on Port '+ parseInt(send_port) + ' transmitted! Length of message was ' + message.length + ' with ' + bytes + ' bytes ');	
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
