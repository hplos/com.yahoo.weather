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
		Homey.manager('speech-input').on('speech', (speech, callback) => {
			console.log(speech);
			console.log(speech.time);

			const options = {
				weather: false,
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
					const forecasts = data.channel.item.forecast;
					console.log(data.channel.item);

					// Check if weather trigger is present
					if (options.weather) {
						let weather, response;

						// Get forecast for specified date
						switch (options.date) {
							case "today":
								weather = yahooAPI.getConditionMetadata(forecasts[0].code).text.singular;

								// Let Homey say response
								say(createResponse(options.language, options.time_transcript, weather, forecasts[0].low, forecasts[0].high));
								break;
							default:

								// Loop over forecasts to see if matching date is available
								let x;
								for (x in forecasts) {
									if (forecasts[x].date == options.date) {
										weather = yahooAPI.getConditionMetadata(forecasts[x].code).text.singular;
										break;
									}
								}

								// Let Homey say response
								say(createResponse(options.language, options.time_transcript, weather, forecasts[x].low, forecasts[x].high));
						}
					}

				});
			});
		}

		function say(text) {
			Homey.manager('speech-output').say(text);
		}
	}
};

function createResponse(language, moment, weather, low, high) {
	switch (language) {
		case "en":
			if (weather) {
				return `${moment} it will be ${weather}, and the temperature will range from ${low} to ${high} degrees Celsius`;
			}
			else {
				return "I am sorry, there is no forecast available for this day yet.";
			}
			break;
		case "nl":
			if (weather) {
				return `${moment} wordt het ${weather}, en de temperatuur loopt op van ${low} naar ${high} graden Celsius`;
			}
			else {
				return "Helaas, er is voor deze dag nog geen weersvoorspelling beschikbaar."
			}
			break;
	}
}