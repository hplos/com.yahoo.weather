'use strict';

const request = require('request-promise');
const GoogleMapsAPI = require('googlemaps');
const EventEmitter = require('events');

const googleMapsAPI = new GoogleMapsAPI({
	key: Homey.env.GOOGLE_API_KEY,
	stagger_time: 1000,
	encode_polylines: false,
	secure: true
});

class YahooWeather extends EventEmitter {

	constructor(options) {
		super();

		// Set defaults
		this.temp_metric = options.temp_metric;
		this.latitude = options.latitude;
		this.longitude = options.longitude;
		this.location = options.location;

		// These will be retrieved
		this.woeid = undefined;

		// Start polling for information
		if (options.polling) {
			this._startPolling();
		}

		// Retrieve city name and woeid
		this._getWoeid();

		// Expose yahoo weather queries
		this.queries = function createQueries() {
			return {
				forecast: `select * from weather.forecast where woeid=${this.woeid} and u="${this.temp_metric}"`,
				current: `select * from weather.forecast where woeid=${this.woeid} and u="f"`,
			};
		};
	}

	_reverseGeoLocation(lat, lon) {
		return new Promise(function (resolve, reject) {
			googleMapsAPI.reverseGeocode({
				"latlng": `${lat},${lon}`,
				"result_type": "locality",
				"language": "en",
				"location_type": "APPROXIMATE"
			}, function (err, data) {
				if (!err && data && data.results.length > 0) {
					resolve(data.results[0].address_components[0].long_name)
				}
				else {
					reject()
				}
			});
		});
	}

	_convertLocationToWoeid(location) {

		// Make request to retrieve woeid of location
		return request(`http://where.yahooapis.com/v1/places.q('${location}')?format=json&appid=${Homey.env.YAHOO_CLIENT_ID}`);
	}

	_getWoeid() {

		// Do not re-fetch value if present
		if (this.woeid) return Promise.resolve(this.woeid);

		// Fetch woeid and return promise
		return new Promise((resolve, reject) => {

			// Check if lat long are provided
			if (this.latitude && this.longitude) {

				// First reverse lat long to a location name
				this._reverseGeoLocation(this.latitude, this.longitude)
					.then((res) => {

						// Store location name
						this.location = res;

						// Covert location name to woeid
						this._convertLocationToWoeid(this.location)
							.then((res) => {

								// Store woeid
								this.woeid = JSON.parse(res).places.place[0].woeid;

								// Resolve promise
								resolve(this.woeid);
							})
							.catch((err) => {
								console.error(`Error converting location to woeid: ${err}`);

								// Failed
								reject(err);
							});
					})
					.catch((err) => {
						console.error(`Error reversing geo location: ${err}`);

						// Failed
						reject(err);
					});
			}
			else if (this.location) { // Get woeid from provided location

				// Covert location name to woeid
				this._convertLocationToWoeid(this.location)
					.then((res) => {

						// Store woeid
						this.woeid = JSON.parse(res).places.place[0].woeid;

						// Resolve promise
						resolve(this.woeid);
					})
					.catch((err) => {
						console.error(`Error converting location to woeid: ${err}`);

						// Failed
						reject(new Error("converting location to woeid"));
					});
			}
		});
	}

	_queryYahooAPI(weatherYQL) {

		// Make request to fetch weather information from yahoo
		return request(weatherYQL);
	}

	getConditionMetadata(code) {

		// Get metadata belonging to weather code
		return yahooConditions[(code === '3200') ? 48 : code]
	}

	fetchData() {

		// Return promise
		return new Promise((resolve, reject) => {

			// Make sure woeid is set
			this._getWoeid().then(() => {

				// Make two queries simultaneously
				Promise.all([this._queryForecasts(), this._queryCurrent()]).then(data => {
					if (data[0] && data[1]) {

						// Correct for wrong metric format by yahoo
						data[0].atmosphere = data[1].atmosphere;

						// Resolve
						resolve(this._parseData(data[0]));

					}
					else {

						// Error
						reject();
					}

				}).catch(err => {

					// Reject
					reject(err);
				})

			}).catch((err) => {

				// Reject
				reject(err);
			});
		});
	}

	_queryForecasts() {
		return new Promise((resolve, reject) => {

			// Make the weather api request
			this._queryYahooAPI('https://query.yahooapis.com/v1/public/yql?q=' + encodeURIComponent(this.queries().forecast) + '&format=json')
				.then((data) => {
					let jsonData = JSON.parse(data);

					// If no data provided, try again
					if (!jsonData.query.results) {

						// Make the weather api request
						this._queryYahooAPI('https://query.yahooapis.com/v1/public/yql?q=' + encodeURIComponent(this.queries().forecast) + '&format=json')
							.then((data) => {

								// Resolve with data
								resolve(JSON.parse(data).query.results.channel);
							})
							.catch((err) => {

								// Reject
								reject(err);
							});
					}
					else {

						// Resolve with data
						resolve(jsonData.query.results.channel);
					}
				}).catch((err) => {

				// Reject
				reject(err);
			});
		})
	}

	_queryCurrent() {
		return new Promise((resolve, reject) => {

			// Make the weather api request
			this._queryYahooAPI('https://query.yahooapis.com/v1/public/yql?q=' + encodeURIComponent(this.queries().current) + '&format=json')
				.then((data) => {
					let jsonData = JSON.parse(data);

					// If no data provided, try again
					if (!jsonData.query.results) {

						// Make the weather api request
						this._queryYahooAPI('https://query.yahooapis.com/v1/public/yql?q=' + encodeURIComponent(this.queries().current) + '&format=json')
							.then((data) => {

								// Resolve with data
								resolve(JSON.parse(data).query.results.channel);
							})
							.catch((err) => {

								// Reject
								reject(err);
							});
					}
					else {

						// Resolve with data
						resolve(jsonData.query.results.channel);
					}
				}).catch((err) => {

				// Reject
				reject(err);
			});
		})
	}

	_parseData(data) {

		// If no data found throw error
		if (!data) throw Error("no data");

		let forecasts = data.item.forecast;

		// Loop over all forecasts
		for (let x in forecasts) {

			// Retrieve metadata
			const metadata = this.getConditionMetadata(forecasts[x].code);

			// Merge the objects
			for (let y in metadata) {
				forecasts[x][y] = metadata[y];
			}
		}

		// Construct current object
		let current = {
			wind: data.wind,
			atmosphere: data.atmosphere,
			astronomy: data.astronomy,
			code: data.item.condition.code,
			temperature: data.item.condition.temp
		};

		// Get metadata for current
		const metadata = this.getConditionMetadata(current.code);

		// Merge the objects
		for (let y in metadata) {
			current[y] = metadata[y];
		}

		return {
			current: current,
			forecasts: forecasts
		}
	}

	_startPolling() {

		// Refresh data every 60 seconds
		setInterval(() => {

			this.fetchData().then((data)=> {

				// Construct updated data set
				var newData = {
					wind: data.current.wind,
					atmosphere: data.current.atmosphere,
					astronomy: data.current.astronomy,
					temperature: data.current.temperature,
					weatherType: data.current.type
				};

				// Iterate over first level
				for (let x in this.data) {

					// Check for more levels
					if (typeof this.data[x] == "object") {

						// Loop over second level
						for (let y in this.data[x]) {
							if (this.data[x][y] != newData[x][y]) {
								console.log("change detected");
								console.log(x + "_" + y + " old: " + this.data[x][y] + " new: " + newData[x][y]);
								this.emit(x + "_" + y, newData[x][y]);
							}
						}
					}
					else {
						if (this.data[x] != newData[x]) {
							console.log("change detected");
							console.log(x + " old: " + this.data[x] + " new: " + newData[x]);
							this.emit(x, newData[x][y]);
						}
					}
				}

				// Update data set
				this.data = newData;
			})
		}, 10000);
	}

	get(attribute, callback) {
		if (attribute) {
			var attrs = attribute.split("_");
			var result;
			if (this.data) {
				if (attrs.length > 0) {
					if (this.data[attrs[0]]) {
						result = this.data[attrs[0]][attrs[1]];
					}
					else {
						callback(true, false);
					}
				}
				else {
					result = this.data[attrs[0]];
				}
				callback(null, result);
			}
			else {
				callback(true, false);
			}
		}
		else {
			callback(true, false);
		}
	}
}

const yahooConditions = [
	{
		'index': 0,
		'type': 'tornado',
		'quantity': undefined,
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': "tornado's",
				'en': 'tornados',
				'plural': true
			}
		},
	},
	{
		'index': 1,
		'type': 'tropical storm',
		'quantity': undefined,
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': 'een tropische storm',
				'en': 'a tropical storm',
				'plural': false
			}
		},
	},
	{
		'index': 2,
		'type': 'huricane',
		'quantity': undefined,
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': 'een orkaan',
				'en': 'a huricane',
				'plural': false
			}
		},
	},
	{
		'index': 3,
		'type': 'severe thunderstorms',
		'quantity': 'severe',
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': 'zware onweersbuien',
				'en': 'severe thunderstorms',
				'plural': true
			}
		},
	},
	{
		'index': 4,
		'type': 'thunderstorm',
		'quantity': 'severe',
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': 'onweer',
				'en': 'a thunderstorm',
				'plural': false
			}
		},
	},
	{
		'index': 5,
		'type': 'rain and snow',
		'quantity': 'mixed',
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': 'regen en sneeuw',
				'en': 'rain and snow',
				'plural': false
			}
		},
	},
	{
		'index': 6,
		'type': 'rain and sleet',
		'quantity': 'mixed',
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': 'regen en ijzel',
				'en': 'rain and sleet',
				'plural': false
			}
		},
	},
	{
		'index': 7,
		'type': 'snow and sleet',
		'quantity': 'mixed',
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': 'sneeuw en ijzel',
				'en': 'snow and sleet',
				'plural': false
			}
		},
	},
	{
		'index': 8,
		'type': 'freezing drizzle',
		'quantity': undefined,
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': 'lichte ijzel',
				'en': 'freezing drizzle',
				'plural': false
			}
		},
	},
	{
		'index': 9,
		'type': 'drizzle',
		'quantity': undefined,
		'text': {
			'adjective': {
				'nl': 'licht regenachtige',
				'en': 'drizzly'
			},
			'noun': {
				'nl': 'motregen',
				'en': 'drizzle',
				'plural': false
			}
		},
	},
	{
		'index': 10,
		'type': 'freezing rain',
		'quantity': undefined,
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': 'ijzel',
				'en': 'freezing rain',
				'plural': false
			}
		},
	},
	{
		'index': 11,
		'type': 'shower',
		'quantity': undefined,
		'text': {
			'adjective': {
				'nl': 'regenachtige',
				'en': 'rainy'
			},
			'noun': {
				'nl': 'regenbuien',
				'en': 'showers',
				'plural': true
			}
		},
	},
	{
		'index': 12,
		'type': 'shower',
		'quantity': undefined,
		'text': {
			'adjective': {
				'nl': 'regenachtige',
				'en': 'rainy'
			},
			'noun': {
				'nl': 'regenbuien',
				'en': 'showers',
				'plural': true
			}
		},
	},
	{
		'index': 13,
		'type': 'snow flurry',
		'quantity': undefined,
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': 'sneeuw vlagen',
				'en': 'snow flurry',
				'plural': false
			}
		},
	},
	{
		'index': 14,
		'type': 'snow shower',
		'quantity': 'light',
		'text': {
			'adjective': {
				'nl': 'sneeuwachtige',
				'en': 'snowy'
			},
			'noun': {
				'nl': 'sneeuw',
				'en': 'snow showers',
				'plural': true
			}
		},
	},
	{
		'index': 15,
		'type': 'blowing snow',
		'quantity': undefined,
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': 'sneeuwbuien',
				'en': 'blowing snow',
				'plural': false
			}
		},
	},
	{
		'index': 16,
		'type': 'snow',
		'quantity': undefined,
		'text': {
			'adjective': {
				'nl': 'sneeuwachtige',
				'en': 'snowy'
			},
			'noun': {
				'nl': 'snow',
				'en': 'snow',
				'plural': false
			}
		},
	},
	{
		'index': 17,
		'type': 'hail',
		'quantity': undefined,
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': 'hagel',
				'en': 'hail',
				'plural': false
			}
		},
	},
	{
		'index': 18,
		'type': 'sleet',
		'quantity': undefined,
		'text': {
			'adjective': {
				'nl': 'ijzelige',
				'en': 'sleety'
			},
			'noun': {
				'nl': 'ijzel',
				'en': 'sleet',
				'plural': false
			}
		},
	},
	{
		'index': 19,
		'type': 'dust',
		'quantity': undefined,
		'text': {
			'adjective': {
				'nl': 'stoffige',
				'en': 'dusty'
			},
			'noun': {
				'nl': 'stof',
				'en': 'dust',
				'plural': false
			}
		},
	},
	{
		'index': 20,
		'type': 'fog',
		'quantity': undefined,
		'text': {
			'adjective': {
				'nl': 'mistige',
				'en': 'foggy'
			},
			'noun': {
				'nl': 'mist',
				'en': 'fog',
				'plural': false
			}
		},
	},
	{
		'index': 21,
		'type': 'haze',
		'quantity': undefined,
		'text': {
			'adjective': {
				'nl': 'mistige',
				'en': 'hazy'
			},
			'noun': {
				'nl': 'mist',
				'en': 'haze',
				'plural': false
			}
		},
	},
	{
		'index': 22,
		'type': 'smoke',
		'quantity': undefined,
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': 'rookwolken',
				'en': 'smoke clouds',
				'plural': true
			}
		},
	},
	{
		'index': 23,
		'type': 'wind',
		'quantity': undefined,
		'text': {
			'adjective': {
				'nl': 'winderige',
				'en': 'windy'
			},
			'noun': {
				'nl': 'wind',
				'en': 'wind',
				'plural': false
			}
		},
	},
	{
		'index': 24,
		'type': 'wind',
		'quantity': undefined,
		'text': {
			'adjective': {
				'nl': 'winderige',
				'en': 'windy'
			},
			'noun': {
				'nl': 'wind',
				'en': 'wind',
				'plural': false
			}
		},
	},
	{
		'index': 25,
		'type': 'cold',
		'quantity': undefined,
		'text': {
			'adjective': {
				'nl': 'koude',
				'en': 'cold'
			},
			'noun': {
				'nl': 'kou',
				'en': 'cold',
				'plural': false
			}
		},
	},
	{
		'index': 26,
		'type': 'clouds',
		'quantity': undefined,
		'text': {
			'adjective': {
				'nl': 'bewolkte',
				'en': 'cloudy'
			},
			'noun': {
				'nl': 'bewolking',
				'en': 'clouds',
				'plural': true
			}
		},
	},
	{
		'index': 27,
		'type': 'clouds',
		'quantity': 'mostly',
		'text': {
			'adjective': {
				'nl': 'erg bewolkte',
				'en': 'mostly cloudy'
			},
			'noun': {
				'nl': 'veel bewolking',
				'en': 'quite some clouds',
				'plural': true
			}
		},
	},
	{
		'index': 28,
		'type': 'clouds',
		'quantity': 'mostly',
		'text': {
			'adjective': {
				'nl': 'erg bewolkte',
				'en': 'mostly cloudy'
			},
			'noun': {
				'nl': 'veel bewolking',
				'en': 'quite some clouds',
				'plural': true
			}
		},
	},
	{
		'index': 29,
		'type': 'clouds',
		'quantity': 'partly',
		'text': {
			'adjective': {
				'nl': 'licht bewolkte',
				'en': 'partly cloudy'
			},
			'noun': {
				'nl': 'lichte bewolking',
				'en': 'some clouds',
				'plural': true
			}
		},
	},
	{
		'index': 30,
		'type': 'clouds',
		'quantity': 'partly',
		'text': {
			'adjective': {
				'nl': 'licht bewolkte',
				'en': 'partially cloudy'
			},
			'noun': {
				'nl': 'lichte bewolking',
				'en': 'some clouds',
				'plural': true
			}
		},
	},
	{
		'index': 31,
		'type': 'clear',
		'quantity': undefined,
		'text': {
			'adjective': {
				'nl': 'heldere',
				'en': 'clear'
			},
			'noun': {
				'nl': 'helder',
				'en': 'clear',
				'plural': false
			}
		},
	},
	{
		'index': 32,
		'type': 'sun',
		'quantity': undefined,
		'text': {
			'adjective': {
				'nl': 'zonnige',
				'en': 'sunny'
			},
			'noun': {
				'nl': 'zon',
				'en': 'sun',
				'plural': false
			}
		},
	},
	{
		'index': 33,
		'type': 'fair',
		'quantity': undefined,
		'text': {
			'adjective': {
				'nl': 'mooie',
				'en': 'fair'
			},
			'noun': {
				'nl': 'mooi',
				'en': undefined,
				'plural': false
			}
		},
	},
	{
		'index': 34,
		'type': 'fair',
		'quantity': undefined,
		'text': {
			'adjective': {
				'nl': 'mooie',
				'en': 'fair'
			},
			'noun': {
				'nl': 'mooi',
				'en': undefined,
				'plural': false
			}
		},
	},
	{
		'index': 35,
		'type': 'rain and hail',
		'quantity': 'mixed',
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': 'regen en hagel',
				'en': 'rain and hail',
				'plural': false
			}
		},
	},
	{
		'index': 36,
		'type': 'hot',
		'quantity': undefined,
		'text': {
			'adjective': {
				'nl': 'warme',
				'en': 'hot'
			},
			'noun': {
				'nl': 'warm',
				'en': 'hot',
				'plural': false
			}
		},
	},
	{
		'index': 37,
		'type': 'thunderstorm',
		'quantity': undefined,
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': 'zwaar onweer',
				'en': 'thunderstorms',
				'plural': true
			}
		},
	},
	{
		'index': 38,
		'type': 'thunderstorm',
		'quantity': undefined,
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': 'zwaar onweer',
				'en': 'thunderstorms',
				'plural': true
			}
		},
	},
	{
		'index': 39,
		'type': 'thunderstorm',
		'quantity': undefined,
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': 'zwaar onweer',
				'en': 'thunderstorms',
				'plural': true
			}
		},
	},
	{
		'index': 40,
		'type': 'shower',
		'quantity': undefined,
		'text': {
			'adjective': {
				'nl': 'regenachtige',
				'en': 'rainy'
			},
			'noun': {
				'nl': 'regenbuien',
				'en': 'showers',
				'plural': true
			}
		},
	},
	{
		'index': 41,
		'type': 'snow',
		'quantity': 'heavy',
		'text': {
			'adjective': {
				'nl': 'sneeuwachtige',
				'en': 'snowy'
			},
			'noun': {
				'nl': 'zware sneeuwbuien',
				'en': 'heavy snow',
				'plural': false
			}
		},
	},
	{
		'index': 42,
		'type': 'snow',
		'quantity': undefined,
		'text': {
			'adjective': {
				'nl': 'sneeuwachtige',
				'en': 'snowy'
			},
			'noun': {
				'nl': 'sneeuwbuien',
				'en': 'snow',
				'plural': false
			}
		},
	},
	{
		'index': 43,
		'type': 'snow',
		'quantity': 'heavy',
		'text': {
			'adjective': {
				'nl': 'sneeuwachtige',
				'en': 'snowy'
			},
			'noun': {
				'nl': 'zware sneeuwbuien',
				'en': 'heavy snow',
				'plural': false
			}
		},
	},
	{
		'index': 44,
		'type': 'clouds',
		'quantity': 'partly',
		'text': {
			'adjective': {
				'nl': 'matig bewolkte',
				'en': 'partially cloudy'
			},
			'noun': {
				'nl': 'matige bewolking',
				'en': 'some clouds',
				'plural': true
			}
		},
	},
	{
		'index': 45,
		'type': 'thundershowers',
		'quantity': undefined,
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': 'onweer en zware regenbuien',
				'en': 'thunderstorms',
				'plural': true
			}
		},
	},
	{
		'index': 46,
		'type': 'snow',
		'quantity': undefined,
		'text': {
			'adjective': {
				'nl': 'sneeuwachtige',
				'en': 'snowy'
			},
			'noun': {
				'nl': 'sneeuwbuien',
				'en': 'snow',
				'plural': false
			}
		},
	},
	{
		'index': 47,
		'type': 'thundershowers',
		'quantity': undefined,
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': 'onweer en zware regenbuien',
				'en': 'thunderstorms',
				'plural': true
			}
		},
	},
	{
		'index': 3200,
		'type': 'unavailable',
		'quantity': undefined,
		'text': {
			'adjective': undefined,
			'noun': {
				'nl': 'niet beschikbaar',
				'en': 'unavailable',
				'plural': false
			}
		},
	},
];

module.exports = YahooWeather;
