'use strict';

const YahooWeather = require('./node-yahoo-weather');

module.exports = {

	init: function init() {
		let latitude;
		let longitude;

		// Ask Homey for current location
		Homey.manager('geolocation').getLocation((err, location) => {
			latitude = location.latitude;
			longitude = location.longitude;
		});

		// Listen on speech input
		Homey.manager('speech-input').on('speech', (speech, callback) => {
			console.log(speech);
			const options = {
				weather: false,
				date: 'today',
				location: undefined,
			};

			speech.triggers.forEach(trigger => {
				switch (trigger.id) {
					case 'weather':
						options.weather = true;
						break;
					case 'today':
						options.date = 'today';
						break;
					case 'tomorrow':
						options.date = 'tomorrow';
						break;
					default:
						break;
				}
			});

			processSpeechRequest(options);
		});

		function processSpeechRequest(options) {

			// Create yahoo weather api instance
			const yahooAPI = new YahooWeather({
				temp_metric: 'c',
				latitude: latitude,
				longitude: longitude
			}).fetchData().then((data) => {
				const forecasts = data.channel.item.forecast;
				console.log(options);
				if (options.weather && options.date === 'today') {
					const weather = yahooAPI.getConditionMetadata(forecasts[1].code).text.singular;
					const response = `Today it will be ${weather}`;
					console.log(response);
					// Let Homey say response
					say(response);
				}
				if (options.weather && options.date === 'tomorrow') {

					var weather = yahooAPI.getConditionMetadata(forecasts[1].code).text.singular;
					var response = `Tomorrow it will be ${weather}`;
					console.log(response);
					// Let Homey say response
					say(response);
				}

			});

		}

		function say(text) {
			Homey.manager('speech-output').say(text);
		}
	},
};
