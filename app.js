'use strict';

const YahooWeather = require('./node-yahoo-weather');
const moment = require('moment');

module.exports = {

	init: function init() {
		let latitude;
		let longitude;

		// Ask Homey for current location
		let locationPromise = new Promise(function (resolve) {

			// Fetch location
			Homey.manager('geolocation').getLocation((err, location) => {
				latitude = location.latitude;
				longitude = location.longitude;
				resolve();
			});
		});

		// Listen on speech input
		Homey.manager('speech-input').on('speech', (speech) => {
			console.log(speech);
			console.log(speech.time);

			const options = {
				weather: false,
				temperature: false,
				date: 'today',
				location: undefined,
				language: speech.language
			};

			switch (options.language) {
				case "nl":
					options.time_transcript = "vandaag";
					break;
				default:
					options.time_transcript = "today";
			}

			// If time triggers is recognized
			if (speech.time) {

				// Indicate that a date has been found
				options.date = true;

				// Multiple triggers
				if (speech.time.length > 1) {
					// TODO multiple triggers for time
				}
				else if (speech.time.length > 0) {

					// Single trigger
					const day = speech.time[0].time.day;
					const month = speech.time[0].time.month + 1;
					const year = speech.time[0].time.year || moment().year();

					// Parse data in usable date
					if (day && month && year) {
						options.date = moment(`${day}:${month}:${year}`, "D:M:YYYY").format("DD MMM YYYY");
						options.time_transcript = speech.time[0].transcript;
					}
				}
			}

			// Process triggers found
			speech.triggers.forEach(trigger => {
				switch (trigger.id) {
					case 'weather':
						options.weather = true;
						break;
					case 'current':
						options.date = 'current';
						options.time_transcript = 'current';
						break;
					case 'temperature':
						options.temperature = true;
						break;
					default:
						break;
				}
			});

			processSpeechRequest(options);
		});

		function processSpeechRequest(options) {

			// Wait for location data to be fetched
			Promise.all([locationPromise]).then(function () {

				// Create yahoo weather api instance
				const yahooAPI = new YahooWeather({
					temp_metric: 'c',
					latitude: latitude,
					longitude: longitude
				});

				// Fetch weather data
				yahooAPI.fetchData().then((data) => {
					let weather;
					const forecasts = data.channel.item.forecast;
					const current = {
						wind: data.channel.wind,
						atmosphere: data.channel.atmosphere,
						astronomy: data.channel.astronomy,
						code: data.channel.item.condition.code,
						temperature: data.channel.item.condition.temp
					};

					// Get forecast for specified date
					switch (options.date) {
						case "current":

							// Only process weather if asked for
							if (options.weather) weather = yahooAPI.getConditionMetadata(current.code);

							// Let Homey say response
							say(createResponse(current, options.language, options.time_transcript, weather, options.temperature, forecasts[0].low, forecasts[0].high));
							break;
						case "today":

							// Only process weather if asked for
							if (options.weather) weather = yahooAPI.getConditionMetadata(forecasts[0].code);

							// Let Homey say response
							say(createResponse(current, options.language, options.time_transcript, weather, options.temperature, forecasts[0].low, forecasts[0].high));
							break;
						default:

							// Loop over forecasts to see if matching date is available
							let x;
							for (x in forecasts) {
								if (forecasts[x].date == options.date) {
									if (options.weather) weather = yahooAPI.getConditionMetadata(forecasts[x].code);
									break;
								}
							}

							// Let Homey say response
							say(createResponse(current, options.language, options.time_transcript, weather, options.temperature, forecasts[x].low, forecasts[x].high));
					}
				});
			});
		}

		function say(text) {
			Homey.manager('speech-output').say(text);
		}
	}
};

function createResponse(currentWeather, language, moment, weather, temperature, low, high) {

	// Determine form to use for sentence (noun/adjective)
	let form;

	// Check for incoming data
	if (weather) {

		// Check whether adjective or noun is present
		if (weather.text.adjective && weather.text.adjective[language]
			&& weather.text.noun && weather.text.noun[language]) {
			const random = Math.round(Math.random());
			if (random === 1) form = "adjective";
			else form = "noun";
		}
		else if (weather.text.adjective && weather.text.adjective[language]) {
			form = "adjective";
		}
		else if (weather.text.noun && weather.text.noun[language]) {
			form = "noun";
		}
	}

	switch (language) {
		case "en":
			if (weather) {

				// Determine plural of singular prefix
				var prefix = (weather.text[form].plural) ? "are" : "is";

				// Check if asked for forecast or current data
				if (moment === "current") {

					// Create sentence
					if (form == "noun") {
						return `At the moment there ${prefix} ${weather.text[form][language]}, and the temperature is ${currentWeather.temperature} degrees Celsius`;
					}
					else {
						return `At the moment it is ${weather.text[form][language]}, and the temperature is ${currentWeather.temperature} degrees Celsius`;
					}
				}
				else {

					// Create sentence
					if (form == "noun") {
						return `${moment} there ${prefix} ${weather.text[form][language]} expected, the temperature will range from ${low} to ${high} degrees Celsius`;
					}
					else {
						return `${moment} will be a ${weather.text[form][language]} day, and the temperature will range from ${low} to ${high} degrees Celsius`;
					}
				}
			}
			else if (temperature) {
				var prefix = (moment === "today") ? "ranges" : "will range";

				if (moment === "current") {
					return `The outside temperature is ${currentWeather.temperature} degrees Celsius`;
				}
				else {
					return `${moment} the temperature ${prefix} from ${low} to ${high} degrees Celsius`;
				}
			}
			else {
				return "I am sorry, there is no forecast available for this day yet";
			}
			break;

		case "nl":
			if (weather) {

				// Check if asked for forecast or current data
				if (moment === "current") {

					// Create sentence
					if (form == "noun") {
						return `Op het moment is er ${weather.text[form][language]}, en de temperatuur is ${currentWeather.temperature} graden Celsius`;
					}
					else {
						return `${moment} wordt een ${weather.text[form][language]} dag, en de temperatuur loopt op van ${low} naar ${high} graden Celsius`;
					}
				}
				else {
					// Create sentence
					if (form == "noun") {
						return `${moment} wordt er ${weather.text[form][language]} verwacht, de temperatuur loopt op van ${low} naar ${high} graden Celsius`;
					}
					else {
						return `${moment} wordt een ${weather.text[form][language]} dag, en de temperatuur loopt op van ${low} naar ${high} graden Celsius`;
					}
				}
			}
			else if (temperature) {

				if (moment === "current") {
					return `De huidige temperatuur is ${currentWeather.temperature} degrees Celsius`;
				}
				else {
					var prefix = (moment === "today") ? "loopt de temperatuur op" : "zal de temperatuur oplopen";
					return `${moment} ${prefix} van ${low} naar ${high} graden Celsius`
				}
			}
			else {
				return "Helaas, er is voor deze dag nog geen weersvoorspelling beschikbaar"
			}
			break;
	}
}