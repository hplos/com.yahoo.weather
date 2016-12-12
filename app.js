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
		}
	});
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
	Homey.manager('speech-input').on('speech', speech => {

		console.log('Yahoo Weather: incoming speech event');
		console.log(speech);
		console.log(speech.time);

		// Create options object for creating response
		const options = {
			weatherTrigger: false,
			temperatureTrigger: false,
			date: 'current',
			language: language,
			dateTranscript: (language === 'en') ? 'today' : 'vandaag',
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
		if (!options.abort) parseSpeechTriggers(speech, options);

		// Parse time object from speech to options
		if (!options.abort) parseSpeechTime(speech, options);

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
function parseSpeechTriggers(speech, options) {

	// Process triggers found
	speech.triggers.forEach(trigger => {
		switch (trigger.id) {
			case 'weather':
				options.weatherTrigger = true;
				break;
			case 'current':
				options.date = 'current';
				options.dateTranscript = (options.language === 'en') ? 'current' : 'op het moment';
				break;
			case 'will':
				options.date = 'today';
				options.dateTranscript = (options.language === 'en') ? 'today' : 'vandaag';
				break;
			case 'in':
				// Parse transcript for text after "in"
				const textAfterIn = speech.transcript.substring(trigger.position + 3).trim();

				// Check if time detected
				if (speech.time && speech.time[0].transcript) {

					// Check if text after "in" is not a measure of time
					if (textAfterIn.indexOf((speech.time[0].transcript)) === -1
						&& speech.time[0].transcript.indexOf(textAfterIn) === -1) {

						// No time, must be location, set location
						options.location = (textAfterIn || undefined);
					}
				} else {
					// No time, must be location, set location
					options.location = (textAfterIn || undefined);
				}

				break;
			case 'temperature':
				options.temperatureTrigger = true;
				break;
			default:
				break;
		}
	});
}

/**
 * Parse the time object provided by the speech
 * object, this in order to give accurate and timely
 * data to the user.
 * @param speech
 * @param options
 */
function parseSpeechTime(speech, options) {

	// If time triggers is recognized
	if (speech.time) {

		// Indicate that a date has been found
		options.date = true;

		// Multiple triggers
		if (speech.time.length > 1) {

			// Let user know this cant be handled yet
			say(__('general.confused'), {}, speech);

			options.abort = true;
		} else if (speech.time.length > 0) {

			// Single trigger
			const day = speech.time[0].time.day;
			const month = speech.time[0].time.month + 1;
			const year = speech.time[0].time.year || moment().year();

			// Parse data in usable date
			if (day && month && year) {
				options.date = moment(`${day}:${month}:${year}`, 'D:M:YYYY').format('DD MMM YYYY');
				options.dateTranscript = speech.time[0].transcript;

				// Check if the parsed date is today, then use today mode
				if (options.date === moment().format('DD MMM YYYY')) {
					options.date = 'today';
					options.dateTranscript = __('general.today');
				}
			}
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

	options.locationFirst = (Math.round(Math.random()) === 1 && options.location);

	// Determine form to use for sentence (noun/adjective)
	let form;

	// Check for incoming data
	if (options.weatherTrigger) {

		// Check whether adjective or noun is present
		if (data.text.adjective && data.text.adjective[options.language]
			&& data.text.noun && data.text.noun[options.language]) {
			const random = Math.round(Math.random());
			if (random === 1) form = 'adjective';
			else form = 'noun';
		} else if (data.text.adjective && data.text.adjective[options.language]) {
			form = 'adjective';
		} else if (data.text.noun && data.text.noun[options.language]) {
			form = 'noun';
		}

		// Determine plural of singular prefix
		const prefix = (data.text[form].plural) ? 'are' : 'is';

		// Check if asked for forecast or current data
		if (options.date === 'current') {

			// Create sentence
			if (form === 'noun') {
				if (options.locationFirst) {
					return __('weather.current.noun.location_first', {
						prefix: prefix,
						weather: data.text[form][options.language],
						moment: options.dateTranscript,
						temperature: data.temperature,
					});
				}
				return __('weather.current.noun.location_last', {
					prefix: prefix,
					weather: data.text[form][options.language],
					moment: options.dateTranscript,
					temperature: data.temperature,
				});
			}
			if (options.locationFirst) {
				return __('weather.current.adjective.location_first', {
					weather: data.text[form][options.language],
					moment: options.dateTranscript,
					temperature: data.temperature,
				});
			}
			return __('weather.current.adjective.location_last', {
				weather: data.text[form][options.language],
				moment: options.dateTranscript,
				temperature: data.temperature,
			});
		}

		// Create sentence
		if (form === 'noun') {
			if (options.locationFirst) {
				return __('weather.date.noun.location_first', {
					prefix: prefix,
					weather: data.text[form][options.language],
					moment: options.dateTranscript,
					low: data.low,
					high: data.high,
				});
			}
			return __('weather.date.noun.location_last', {
				prefix: prefix,
				weather: data.text[form][options.language],
				moment: options.dateTranscript,
				low: data.low,
				high: data.high,
			});
		}
		if (options.locationFirst) {
			return __('weather.date.adjective.location_first', {
				prefix: prefix,
				weather: data.text[form][options.language],
				moment: options.dateTranscript,
				low: data.low,
				high: data.high,
			});
		}
		return __('weather.date.adjective.location_last', {
			prefix: prefix,
			weather: data.text[form][options.language],
			moment: options.dateTranscript,
			low: data.low,
			high: data.high,
		});
	} else if (options.temperatureTrigger) {
		const prefix = (options.date === 'today') ? __('general.ranges') : __('general.will_range');

		if (options.date === 'current') {
			if (options.locationFirst) {
				return __('temperature.current.location_first', { temperature: data.temperature });
			}
			return __('temperature.current.location_last', { temperature: data.temperature });
		}

		if (options.locationFirst) {
			return __('temperature.date.location_first', {
				prefix: prefix,
				low: data.low,
				high: data.high,
				moment: options.dateTranscript,
			});
		}

		return __('temperature.date.location_last', {
			prefix: prefix,
			low: data.low,
			high: data.high,
			moment: options.dateTranscript,
		});

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
	let result;

	// Append location if desired
	if (options && options.location) {
		if (options.locationFirst) {
			result = `In ${options.location} ${text}`;
		} else {
			result = `${text} in ${options.location}`;
		}
	} else {
		result = text;
	}

	console.log(`Yahoo Weather: let Homey say: ${result}`);

	// Make Homey talk!
	speech.say(result);
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
