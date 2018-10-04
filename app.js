'use strict';

const Log = require('homey-log').Log;

const YahooWeather = require('./node-yahoo-weather');
const moment = require('moment');
let defaultLocation = {
	latitude: undefined,
	longitude: undefined,
};
const language = Homey.manager('i18n').getLanguage();

module.exports.init = function init() {

	// Create location promise
	const locationPromise = new Promise((resolve, reject) => {

		// Ask Homey for current location
		Homey.manager('geolocation').getLocation((err, location) => {
			// Reject or resolve the promise
			if (err) reject(err);
			else {

				// Store as default
				if (typeof location.latitude !== 'undefined' && typeof location.longitude !== 'undefined') {

					console.log(`Yahoo Weather: found location data, lat ${location.latitude} and lng ${location.longitude}`);

					// Make copy of value to prevent disappearing through reference
					defaultLocation = JSON.parse(JSON.stringify(location));

					// Resolve
					resolve({ latitude: location.latitude, longitude: location.longitude });
				}
			}
		});
	});

	// Listen for changes in weather on current location
	listenForWeatherChanges(locationPromise);

	// Start listening for incoming speech events
	listenForSpeechEvents(locationPromise);
};

/**
 * Listen for weather changes and trigger flows
 * when detected.
 * @param locationPromise
 */
function listenForWeatherChanges(locationPromise) {

	// Wait for location data to be fetched
	Promise.all([locationPromise]).then(data => {

		// Make copy of location object
		const location = JSON.parse(JSON.stringify(checkLocation(data[0])));

		// Check for valid location
		if (location) {

			console.log('Yahoo Weather: start listening for weather changes...');

			// Create yahoo weather api instance
			const yahooAPI = new YahooWeather({
				temp_metric: 'c',
				latitude: location.latitude,
				longitude: location.longitude,
				polling: true,
			});

			// Listen for weather changes
			yahooAPI.on('wind_chill', value => {

				// Trigger wind chill flow(degrees)
				Homey.manager('flow').trigger('wind_chill', {
					degrees: parseFloat(value),
				});

			})
				.on('wind_direction', value => {

					// Trigger wind direction flow (degrees)
					Homey.manager('flow').trigger('wind_direction', {
						degrees: parseFloat(value),
					});

				})
				.on('wind_speed', value => {

					// Trigger wind speed flow (kph)
					Homey.manager('flow').trigger('wind_speed', {
						kph: parseFloat(value),
					});

				})
				.on('atmosphere_humidity', value => {

					// Trigger atmosphere humidity flow (mb)
					Homey.manager('flow').trigger('atmosphere_humidity', {
						percent: parseFloat(value),
					});

				})
				.on('atmosphere_pressure', value => {

					// Trigger atmosphere pressure flow (percentage)
					Homey.manager('flow').trigger('atmosphere_pressure', {
						mb: parseFloat(value),
					});

				})
				.on('atmosphere_visibility', value => {

					// Trigger atmosphere visibility flow (km)
					Homey.manager('flow').trigger('atmosphere_visibility', {
						km: parseFloat(value),
					});

				})
				.on('astronomy_sunrise', value => {

					// Trigger atmosphere sunrise flow (hour)
					Homey.manager('flow').trigger('astronomy_sunrise', {
						astronomy_sunrise: moment(value, ['h:mm A']).format('HH:mm'),
					});

				})
				.on('astronomy_sunset', value => {

					// Trigger atmosphere sunset flow (hour)
					Homey.manager('flow').trigger('astronomy_sunset', {
						astronomy_sunset: moment(value, ['h:mm A']).format('HH:mm'),
					});

				})
				.on('temperature', value => {

					// Trigger temperature flow (degrees Celsius)
					Homey.manager('flow').trigger('temperature', {
						temperature: parseFloat(value),
					});
				});

			// When triggered, get latest structure data and check if status is home or not
			Homey.manager('flow').on('condition.atmosphere_rising', (callback, args) => {

				// Check for proper incoming arguments
				if (args != null && args.status) {
					yahooAPI.get('atmosphere_rising', (err, result) => {

						// Parse result
						let status = 'steady';
						if (parseInt(result, 10) === 0) status = 'steady';
						else if (parseInt(result, 10) === 1) status = 'rising';
						else if (parseInt(result, 10) === 2) status = 'falling';

						// Callback result
						callback(err, (status === args.status));
					});
				} else {
					callback(true, false);
				}
			});
    		Homey.manager('flow').on('condition.temperature', temperature);
				Homey.manager('flow').on('condition.wind_speed', windspeed);
		}
	});
}

function temperature(callback, args) {
	console.log('temp check!');
            if (temperature > args.variable) {
                callback(null, true);
            }
            else callback(null, false);
}
function windspeed(callback, args) {
	console.log('winspeed check!');
            if (windspeed > args.variable) {
                callback(null, true);
            }
            else callback(null, false);
}

/**
 * Start listening for incoming speech events
 * @param locationPromise Promise object that needs
 * to be resolved before calls can be made to yahoo
 * api (lat lon is needed).
 */
function listenForSpeechEvents(locationPromise) {

	console.log('Yahoo Weather: start listening for speech events...');

	// Listen on speech input
	Homey.manager('speech-input').on('speech', (speech, callback) => {
		if (speech.allZones && speech.allZones.length > 0) {
			return callback(new Error("user is asking about a zone, not a location"));
		}
		return callback(null, true);
	})

	// Listen on winning speech input
	Homey.manager('speech-input').on('speechMatch', speech => {

		console.log('Yahoo Weather: incoming speech event');
		console.log(speech);
		console.log(speech.times);

		// Create options object for creating response
		const options = {
			weatherRequest: false,
			temperatureRequest: false,
			date: 'current',
			language: language,
			dateTranscript: __('general.current')
		};

		// Say something to indicate processing
		if (Math.round(Math.random()) === 1) {
			speech.say(__('general.wait1'));
		} else {
			speech.say(__('general.wait2'));
		}

		// If no response after 10 seconds abort
		const timeout = setTimeout(() => {
			options.abort = true;
			speech.say(__('general.yahoo_timeout'));
		}, 10000);

		// Parse speech triggers to options
		if (!options.abort) {
			parseSpeech(speech, options);
		} else {
			clearTimeout(timeout);
		}

		console.log('Yahoo Weather: parsing speech object done, fetching weather data information...');

		if (!options.abort) {

			// Fetch weather data
			fetchWeatherData(locationPromise, speech, options).then(data => {
				console.log('Yahoo Weather: fetching weather data done');

				// Clear timeout we have got a response
				clearTimeout(timeout);

				// Use received data to create response to speech request
				prepareResponse(speech, options, data);

				console.log('Yahoo Weather: prepare response done');

			}).catch(err => {
				console.log('Error fetching weather data: ', err);
				clearTimeout(timeout);
			});
		} else {
			clearTimeout(timeout);
		}
	});
}

/**
 * Parse the found speech triggers into a usable
 * options object in order to create an accurate
 * response.
 * @param speech
 * @param options
 */
function parseSpeech(speech, options) {

	//set options based on speech info
	const requestType = (speech.matches.weatherRequest) ? 'weatherRequest' : 'temperatureRequest';
	options[requestType] = true;

	//store location if present
	if (speech.matches[requestType].LOCATION)
		options.location = speech.matches[requestType].LOCATION;

	//parse time
	parseSpeechTime(speech, options);
}

/**
 * Parse the time object provided by the speech
 * object, this in order to give accurate and timely
 * data to the user.
 * @param speech
 * @param options
 */
function parseSpeechTime(speech, options) {

	// Multiple times
	if (speech.times.length > 1) {

		// Let user know this cant be handled yet
		say(__('general.confused'), {}, speech);

		options.abort = true;
	} else if (speech.times.length > 0) {

		// Parse data in usable date
		if (speech.times[0].time.future ) {

			options.date = moment(speech.times[0].time.future).format('DD MMM YYYY');
			options.dateTranscript = speech.times[0].transcript;

			// Check if the parsed date is today, then use today mode
			if (options.date === moment().format('DD MMM YYYY')) {
				options.date = 'today';
				options.dateTranscript = __('general.today');
			}
		} else if (speech.times[0].time.past && moment(speech.times[0].time.past).format('DD MMM YYYY') === moment().format('DD MMM YYYY') ) {
			//today

				options.date = 'today';
				options.dateTranscript = __('general.today');
		} else {
			//in the past

			// Let user know this cant be handled yet
			say(__('general.confused'), {}, speech);

			options.abort = true;
		}
	}
}

/**
 * Fetch the weather data from the Yahoo api
 * @param locationPromise Promise to wait fore before
 * making a request.
 * @param speech
 * @param options
 * @returns {Promise}
 */
function fetchWeatherData(locationPromise, speech, options) {
	return new Promise((resolve, reject) => {

		// Wait for location data to be fetched
		Promise.all([locationPromise]).then(locationData => {

			// Make copy of location object
			const location = JSON.parse(JSON.stringify(checkLocation(locationData[0])));

			// Check for valid location
			if (location) {

				// Remove Homey location if alternative is provided
				if (options.location) {
					location.latitude = undefined;
					location.longitude = undefined;
				}

				// Create yahoo weather api instance
				const yahooAPI = new YahooWeather({
					temp_metric: 'c',
					latitude: location.latitude,
					longitude: location.longitude,
					location: options.location,
				});

				// Fetch weather data
				yahooAPI.fetchData().then(data => {

					// Resolve promise with formatted data
					resolve(data);

				}).catch(err => {

					// Handle unknown location
					if (err && (err.message === 'converting location to woeid' || err.message === 'no data')) {
						options.abort = true;
						say(__('general.no_data_on_location'), {}, speech);
					} else if (err === 'no_info_location') {
						options.abort = true;
						speech.say(__('general.no_data_on_location'));
					} else {
						options.abort = true;
						say(__('general.error'), {}, speech);
					}

					reject(err);
				});
			} else {
				options.abort = true;
				say(__('general.error'), {}, speech);
			}
		});
	});
}

/**
 * Prepare the data for creating the response,
 * select data according to request of user
 * @param speech
 * @param options
 * @param data
 */
function prepareResponse(speech, options, data) {

	// Get forecast for specified date
	switch (options.date) {
		case 'current':

			// Let Homey say response
			say(createResponse(options, data.current), options, speech);
			break;
		case 'today':

			// Let Homey say response
			say(createResponse(options, data.forecasts[0]), options, speech);
			break;
		default:

			// Loop over forecasts to see if matching date is available
			let x;
			for (x in data.forecasts) {
				if (data.forecasts[x].date === options.date) {
					break;
				}
			}

			// Let Homey say response
			say(createResponse(options, data.forecasts[x]), options, speech);
	}
}

/**
 * Create the response for the users request
 * @param options
 * @param data
 * @returns {*} String that Homey will pronounce
 */
function createResponse(options, data) {
	console.log('Yahoo Weather: creating response...');

	if (options.weatherRequest) {

		//add some variation to the responses
		let form;

		// Check whether adjective is present
		if (data.text.adjective && data.text.adjective[options.language]
			&& data.text.noun && data.text.noun[options.language]) {

			form = (Math.round(Math.random()) === 1) ? 'adjective' : 'noun';
		} else if (data.text.adjective && data.text.adjective[options.language]) {
			form = 'adjective';
		} else {
			form = 'noun';
		}

		const responseProperties = {
			weather: data.text[form][options.language],
			moment: options.dateTranscript,
			location: (options.location) ? ` ${__('general.in')} ${options.location}` : ""
		}

		// Check if asked for forecast or right now
		if (options.date === 'current') {

			responseProperties.prefix = (data.text[form].plural) ? __('general.are') : __('general.is');
			responseProperties.temperature = data.temperature;

			return __(`weather.current.${form}`, responseProperties);
		} else{
			// Create sentence for today or date

			responseProperties.prefix = (data.text[form].plural) ? __('general.will_plural') : __('general.will_singular');
			responseProperties.low = data.low;
			responseProperties.high = data.high;

			return __(`weather.date.${form}`, responseProperties);
		}

	} else if (options.temperatureRequest) {

		if (options.date === 'current') {

			return __('temperature.current', {
				temperature: data.temperature,
				location: (options.location) ? ` ${__('general.in')} ${options.location}` : "",
			});
		} else {

			return __('temperature.date', {
				prefix: (options.date === 'today') ? __('general.ranges') : __('general.will_range'),
				moment: options.dateTranscript,
				location: (options.location) ? ` ${__('general.in')} ${options.location}` : "",
				low: data.low,
				high: data.high,
			});
		}
	}

	return __('general.no_forecast');
}

/**
 * Takes a string and options object and
 * makes Homey speak the response, also used
 * for post-processing the created response.
 * @param text
 * @param options
 * @param speech
 */
function say(text, options, speech) {

	console.log(`Yahoo Weather: let Homey say: ${text}`);

	// Make Homey talk!
	speech.say(text);
}

/**
 * Checks location object,
 * returns location object if
 * valid, or defaultLocation object
 * of false if everything fails.
 * @param location
 * @returns {*}
 */
function checkLocation(location) {

	// Check valid location
	if ((typeof location.latitude === 'undefined'
		|| typeof location.longitude === 'undefined')
	) {
		if (typeof defaultLocation.latitude !== 'undefined'
			&& typeof defaultLocation.longitude !== 'undefined') {

			return defaultLocation;
		}
		return false;

	}

	return location;
}
