'use strict';

const YahooWeather = require('./node-yahoo-weather');
const moment = require('moment');

module.exports.init = function init() {

	// Create location promise
	let locationPromise = new Promise(function (resolve, reject) {

		// Ask Homey for current location
		Homey.manager('geolocation').getLocation((err, location) => {

			// Reject or resolve the promise
			if (err) reject(err);
			else resolve({latitude: location.latitude, longitude: location.longitude});
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
	Promise.all([locationPromise]).then(function (data) {
		var location = data[0];

		// Create yahoo weather api instance
		const yahooAPI = new YahooWeather({
			temp_metric: 'c',
			latitude: location.latitude,
			longitude: location.longitude,
			polling: true
		});

		// Listen for weather changes
		yahooAPI.on("wind_chill", value => {

			// Trigger wind chill flow(degrees)
			Homey.manager('flow').trigger('wind_chill', {
				degrees: parseFloat(value)
			});

		}).on("wind_direction", value => {

			// Trigger wind direction flow (degrees)
			Homey.manager('flow').trigger('wind_direction', {
				degrees: parseFloat(value)
			});

		}).on("wind_speed", value => {

			// Trigger wind speed flow (kph)
			Homey.manager('flow').trigger('wind_speed', {
				kph: parseFloat(value)
			});

		}).on("atmosphere_humidity", value => {

			// Trigger atmosphere humidity flow (mb)
			Homey.manager('flow').trigger('atmosphere_humidity', {
				percent: parseFloat(value)
			});

		}).on("atmosphere_pressure", value => {

			// Trigger atmosphere pressure flow (percentage)
			Homey.manager('flow').trigger('atmosphere_pressure', {
				mb: parseFloat(value)
			});

		}).on("atmosphere_visibility", value => {

			// Trigger atmosphere visibility flow (km)
			Homey.manager('flow').trigger('atmosphere_visibility', {
				km: parseFloat(value)
			});

		}).on("astronomy_sunrise", value => {

			// Trigger atmosphere sunrise flow (hour)
			Homey.manager('flow').trigger('astronomy_sunrise', {
				astronomy_sunrise: moment(value, ["h:mm A"]).format("HH:mm")
			});

		}).on("astronomy_sunset", value => {

			// Trigger atmosphere sunset flow (hour)
			Homey.manager('flow').trigger('astronomy_sunset', {
				astronomy_sunset: moment(value, ["h:mm A"]).format("HH:mm")
			});

		}).on("temperature", value => {

			// Trigger temperature flow (degrees Celsius)
			Homey.manager('flow').trigger('temperature', {
				temperature: parseFloat(value)
			});
		});

		// When triggered, get latest structure data and check if status is home or not
		Homey.manager('flow').on('condition.atmosphere_rising', function (callback, args) {

			// Check for proper incoming arguments
			if (args != null && args.status) {
				yahooAPI.get("atmosphere_rising", function (err, result) {

					// Parse result
					let status = "steady";
					if (parseInt(result) === 0) status == "steady";
					else if (parseInt(result) === 1) status == "rising";
					else if (parseInt(result) === 2) status == "falling";

					// Callback result
					callback(err, (status == args.status));
				})
			}
			else {
				callback(true, false);
			}
		});
	})
}

/**
 * Start listening for incoming speech events
 * @param locationPromise Promise object that needs
 * to be resolved before calls can be made to yahoo
 * api (lat lon is needed).
 */
function listenForSpeechEvents(locationPromise) {

	// Listen on speech input
	Homey.manager('speech-input').on('speech', speech => {
		console.log(speech);
		console.log(speech.time);

		// Create options object for creating response
		const options = {
			weatherTrigger: false,
			temperatureTrigger: false,
			date: 'current',
			language: speech.language,
			dateTranscript: (speech.language === "en") ? "today" : "vandaag"
		};

		// Parse speech triggers to options
		parseSpeechTriggers(speech, options);
		console.log("Parsing speech triggers done");
		// Parse time object from speech to options
		parseSpeechTime(speech, options);
		console.log("Parsing speech time done");

		// Fetch weather data
		fetchWeatherData(locationPromise, speech, options).then(data => {
			console.log("Fetching weather data done");

			// Use received data to create response to speech request
			prepareResponse(speech, options, data);

			console.log("Prepare response done");

		});
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
				options.dateTranscript = (options.language === "en") ? 'current' : 'op het moment';
				break;
			case 'will':
				options.date = 'today';
				options.dateTranscript = (options.language === "en") ? 'today' : 'vandaag';
				break;
			case 'in':
				options.location = (speech.transcript.substring(trigger.position + 3).trim() || undefined);
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
			say((options.language === "en") ? "Sorry, I don't understand what you mean, please specify your request" : 'Sorry, ik snap niet helemaal wat je bedoelt, kun je iets specifieker zijn?', {}, speech);
		}
		else if (speech.time.length > 0) {

			// Single trigger
			const day = speech.time[0].time.day;
			const month = speech.time[0].time.month + 1;
			const year = speech.time[0].time.year || moment().year();

			// Parse data in usable date
			if (day && month && year) {
				options.date = moment(`${day}:${month}:${year}`, "D:M:YYYY").format("DD MMM YYYY");
				options.dateTranscript = speech.time[0].transcript;

				// Check if the parsed date is today, then use today mode
				if (options.date === moment().format("DD MMM YYYY")) {
					options.date = 'today';
					options.dateTranscript = (options.language === "en") ? 'today' : 'vandaag';
				}
			}
		}
	}
}

/**
 * Fetch the weather data from the Yahoo api
 * @param locationPromise Promise to wait fore before
 * making a request.
 * @param options
 * @returns {Promise}
 */
function fetchWeatherData(locationPromise, speech, options) {
	return new Promise((resolve, reject) => {

		// Wait for location data to be fetched
		Promise.all([locationPromise]).then(function (data) {
			var location = data[0];

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
				location: options.location
			});

			// Fetch weather data
			yahooAPI.fetchData().then(data => {

				// Resolve promise with formatted data
				resolve(data);

			}).catch(err => {

				// Handle unknown location
				if (err.message == "converting location to woeid" || err.message == "no data") {
					say((options.language == "en") ? "Sorry, I can not find weather information for that location" : "Sorry, ik kan geen weersinformatie vinden voor die locatie", {}, speech);
				}

				reject(err);
			})
		})
	});
}

/**
 * Prepare the data for creating the response,
 * select data according to request of user
 * @param options
 * @param data
 */
function prepareResponse(speech, options, data) {

	// Get forecast for specified date
	switch (options.date) {
		case "current":

			// Let Homey say response
			say(createResponse(options, data.current), options, speech);
			break;
		case "today":

			// Let Homey say response
			say(createResponse(options, data.forecasts[0]), options, speech);
			break;
		default:

			// Loop over forecasts to see if matching date is available
			let x;
			for (x in data.forecasts) {
				if (data.forecasts[x].date == options.date) {
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
	console.log("Creating response...");
	options.locationFirst = (Math.round(Math.random()) == 1);

	// Determine form to use for sentence (noun/adjective)
	let form;

	// Check for incoming data
	if (options.weatherTrigger) {

		// Check whether adjective or noun is present
		if (data.text.adjective && data.text.adjective[options.language]
			&& data.text.noun && data.text.noun[options.language]) {
			const random = Math.round(Math.random());
			if (random === 1) form = "adjective";
			else form = "noun";
		}
		else if (data.text.adjective && data.text.adjective[options.language]) {
			form = "adjective";
		}
		else if (data.text.noun && data.text.noun[options.language]) {
			form = "noun";
		}
	}

	switch (options.language) {
		case "en":
			if (options.weatherTrigger) {

				// Determine plural of singular prefix
				var prefix = (data.text[form].plural) ? "are" : "is";

				// Check if asked for forecast or current data
				if (options.date === "current") {

					// Create sentence
					if (form == "noun") {
						if (options.locationFirst) return `there ${prefix} ${data.text[form][options.language]} at the moment, and the temperature is ${data.temperature} degrees Celsius`;
						else return `At the moment there ${prefix} ${data.text[form][options.language]}, and the temperature is ${data.temperature} degrees Celsius`;
					}
					else {
						if (options.locationFirst) return `it is ${data.text[form][options.language]} at the moment, and the temperature is ${data.temperature} degrees Celsius`;
						else return `At the moment it is ${data.text[form][options.language]}, and the temperature is ${data.temperature} degrees Celsius`;
					}
				}
				else {

					// Create sentence
					if (form == "noun") {
						if (options.locationFirst) return `there ${prefix} ${data.text[form][options.language]} expected ${options.dateTranscript}, the temperature will range from ${data.low} to ${data.high} degrees Celsius`;
						else return `${options.dateTranscript} there ${prefix} ${data.text[form][options.language]} expected, the temperature will range from ${data.low} to ${data.high} degrees Celsius`;
					}
					else {
						if (options.locationFirst) return `it will be a ${data.text[form][options.language]} day ${options.dateTranscript}, and the temperature will range from ${data.low} to ${data.high} degrees Celsius`;
						else return `${options.dateTranscript} will be a ${data.text[form][options.language]} day, and the temperature will range from ${data.low} to ${data.high} degrees Celsius`;
					}
				}
			}
			else if (options.temperatureTrigger) {
				var prefix = (options.date === "today") ? "ranges" : "will range";

				if (options.date === "current") {
					return `The outside temperature is ${data.temperature} degrees Celsius`;
				}
				else {
					if (options.locationFirst) return `the temperature ${prefix} from ${data.low} to ${data.high} degrees Celsius ${options.dateTranscript}`;
					else return `${options.dateTranscript} the temperature ${prefix} from ${data.low} to ${data.high} degrees Celsius`;
				}
			}
			else {
				return "I am sorry, there is no forecast available for this day yet";
			}
			break;

		case "nl":
			if (options.weatherTrigger) {

				// Check if asked for forecast or current data
				if (options.date === "current") {

					// Create sentence
					if (form == "noun") {
						if (options.locationFirst) return `is er ${data.text[form][options.language]} op het moment, en de temperatuur is ${data.temperature} graden Celsius`;
						else return `Op het moment is er ${data.text[form][options.language]}, en de temperatuur is ${data.temperature} graden Celsius`;
					}
					else {
						if (options.locationFirst) return `wordt het ${options.dateTranscript} een ${data.text[form][options.language]} dag, en de temperatuur loopt op van ${data.low} tot ${data.high} graden Celsius`;
						return `${options.dateTranscript} wordt een ${data.text[form][options.language]} dag, en de temperatuur loopt op van ${data.low} tot ${data.high} graden Celsius`;
					}
				}
				else {
					// Create sentence
					if (form == "noun") {
						if (options.locationFirst) return `wordt er ${options.dateTranscript} ${data.text[form][options.language]} verwacht, de temperatuur loopt op van ${data.low} tot ${data.high} graden Celsius`;
						else return `${options.dateTranscript} wordt er ${data.text[form][options.language]} verwacht, de temperatuur loopt op van ${data.low} tot ${data.high} graden Celsius`;
					}
					else {
						if (options.locationFirst) return `wordt het een ${data.text[form][options.language]} dag ${options.dateTranscript}, en de temperatuur loopt op van ${data.low} tot ${data.high} graden Celsius`;
						return `${options.dateTranscript} wordt een ${data.text[form][options.language]} dag, en de temperatuur loopt op van ${data.low} tot ${data.high} graden Celsius`;
					}
				}
			}
			else if (options.temperatureTrigger) {

				if (options.date === "current") {
					if (options.locationFirst) return `is de huidige temperatuur ${data.temperature} graden Celsius`;
					else return `De huidige temperatuur is ${data.temperature} graden Celsius`;
				}
				else {
					if (options.locationFirst) {
						const prefix = (options.dateTranscript === "today") ? "loopt de temperatuur op" : `zal de temperatuur ${options.dateTranscript} oplopen`;
						return `${prefix} van ${data.low} tot ${data.high} graden Celsius`
					}
					else {
						const prefix = (options.dateTranscript === "today") ? "loopt de temperatuur op" : "zal de temperatuur oplopen";
						return `${options.dateTranscript} ${prefix} van ${data.low} tot ${data.high} graden Celsius`
					}
				}
			}
			else {
				return "Helaas, er is voor deze dag nog geen weersvoorspelling beschikbaar"
			}
			break;
	}
}

/**
 * Takes a string and options object and
 * makes Homey speak the response, also used
 * for post-processing the created response.
 * @param text
 * @param options
 */
function say(text, options, speech) {
	console.log("say: " + text);
	let result;
	// Append location if desired
	if (options && options.location) {
		if (options.locationFirst) {
			result = `In ${options.location} ` + text;

		}
		else {
			result = text + ` in ${options.location}`;
		}
	}
	else {
		result = text;
	}

	// Make Homey talk!
	speech.say(result);
}