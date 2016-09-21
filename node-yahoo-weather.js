'use strict';

const request = require('request-promise');
const yahooConditions = require('./yahoo-conditions');
const GoogleMapsAPI = require('googlemaps');
const EventEmitter = require('events');

const googleMapsAPI = new GoogleMapsAPI({
	key: Homey.env.GOOGLE_API_KEY,
	stagger_time: 1000,
	encode_polylines: false,
	secure: true,
});

class YahooWeather extends EventEmitter {

	constructor(options) {
		super();

		// Set defaults
		this.temp_metric = options.temp_metric;
		this.latitude = options.latitude;
		this.longitude = options.longitude;
		this.location = options.location;

		// Start polling for information
		if (options.polling) {
			this._startPolling();
		}

		// Expose yahoo weather queries
		this.queries = function createQueries(location) {
			return {
				forecast: `select * from weather.forecast where woeid in (select woeid from geo.places(1) 
				where text="${location}") and u="${this.temp_metric}"`,
				current: `select * from weather.forecast where woeid in (select woeid from geo.places(1) 
				where text="${location}") and u="f"`,
			};
		};
	}

	_reverseGeoLocation(lat, lon) {
		return new Promise((resolve, reject) => {
			googleMapsAPI.reverseGeocode({
				latlng: `${lat},${lon}`,
				result_type: 'locality',
				language: 'en',
				location_type: 'APPROXIMATE',
			}, (err, data) => {
				if (!err && data && data.results.length > 0) {
					resolve(data.results[0].address_components[0].long_name);
				} else {
					reject();
				}
			});
		});
	}

	_queryYahooAPI(weatherYQL) {

		// Make request to fetch weather information from yahoo
		return request(weatherYQL);
	}

	getConditionMetadata(code) {

		// Get metadata belonging to weather code
		return yahooConditions[(code === '3200') ? 48 : code];
	}

	fetchData() {

		// Return promise
		return new Promise((resolve, reject) => {
			new Promise(locationResolve => {

				// If lat long provided, do reverse geocoding
				if (this.latitude && this.longitude) {

					// Do reverse geolocation (lat, lng to location name)
					this._reverseGeoLocation(this.latitude, this.longitude)
						.then((location) => locationResolve(location))
						.catch(err => reject(err));
				} else {
					// Resolve with location object found in speech
					locationResolve(this.location);
				}
			}).then(location => {

				// Make two queries simultaneously
				Promise.all([this._queryForecasts(location), this._queryCurrent(location)]).then(data => {
					if (data[0] && data[1]) {

						// Correct for wrong metric format by yahoo
						data[0].atmosphere = data[1].atmosphere;

						// Resolve
						resolve(this._parseData(data[0]));
					} else {

						// Error
						reject();
					}

				}).catch(err => reject(err));
			});
		});
	}

	_queryForecasts(location) {
		return new Promise((resolve, reject) => {

			// Make the weather api request
			this._queryYahooAPI(`https://query.yahooapis.com/v1/public/yql?q=${encodeURIComponent(this.queries(location).forecast)}&format=json`)
				.then((data1) => {
					const jsonData = JSON.parse(data1);

					// If no data provided, try again
					if (!jsonData.query.results) {

						// Make the weather api request
						this._queryYahooAPI(`https://query.yahooapis.com/v1/public/yql?q=${encodeURIComponent(this.queries(location).forecast)}&format=json`)
							.then((data2) => {

								// Resolve with data
								resolve(JSON.parse(data2).query.results.channel);
							})
							.catch((err) => {
								// Reject
								reject(err);
							});
					} else {

						// Resolve with data
						resolve(jsonData.query.results.channel);
					}
				}).catch((err) => {

					// Reject
					reject(err);
				}
			);
		});
	}

	_queryCurrent(location) {
		return new Promise((resolve, reject) => {

			// Make the weather api request
			this._queryYahooAPI(`https://query.yahooapis.com/v1/public/yql?q=${encodeURIComponent(this.queries(location).current)}&format=json`)
				.then((data1) => {
					const jsonData = JSON.parse(data1);

					// If no data provided, try again
					if (!jsonData.query.results) {

						// Make the weather api request
						this._queryYahooAPI(`https://query.yahooapis.com/v1/public/yql?q=${encodeURIComponent(this.queries(location).current)}&format=json`)
							.then((data2) => {

								// Resolve with data
								resolve(JSON.parse(data2).query.results.channel);
							})
							.catch((err) => {

								// Reject
								reject(err);
							});
					} else {

						// Resolve with data
						resolve(jsonData.query.results.channel);
					}
				}).catch((err) => {

					// Reject
					reject(err);
				}
			);
		});
	}

	_parseData(data) {

		// If no data found throw error
		if (!data) throw Error('no data');

		const forecasts = data.item.forecast;

		// Loop over all forecasts
		for (const x in forecasts) {
			if (forecasts[x].code) {

				// Retrieve metadata
				const metadata = this.getConditionMetadata(forecasts[x].code);

				// Merge the objects
				Object.assign(forecasts[x], metadata);
			}
		}

		// Construct current object
		const current = {
			wind: data.wind,
			atmosphere: data.atmosphere,
			astronomy: data.astronomy,
			code: data.item.condition.code,
			temperature: data.item.condition.temp,
		};

		// Get metadata for current
		const metadata = this.getConditionMetadata(current.code);

		// Merge the objects
		Object.assign(current, metadata);

		return {
			current: current,
			forecasts: forecasts,
		};
	}

	_startPolling() {

		// Refresh data every 60 seconds
		setInterval(() => {

			this.fetchData().then((data) => {

				// Construct updated data set
				const newData = {
					wind: data.current.wind,
					atmosphere: data.current.atmosphere,
					astronomy: data.current.astronomy,
					temperature: data.current.temperature,
					weatherType: data.current.type,
				};

				// Iterate over first level
				for (const x in this.data) {

					// Check for more levels
					if (typeof this.data[x] === 'object') {

						// Loop over second level
						for (const y in this.data[x]) {
							if (this.data[x][y] !== newData[x][y]) {
								this.emit(`${x}_${y}`, newData[x][y]);
							}
						}
					} else {
						if (this.data[x] !== newData[x]) {
							this.emit(x, newData[x]);
						}
					}
				}

				// Update data set
				this.data = newData;
			});
		}, 30000);
	}

	get(attribute, callback) {
		if (attribute) {
			const attrs = attribute.split('_');
			let result;
			if (this.data) {
				if (attrs.length > 0) {
					if (this.data[attrs[0]]) {
						result = this.data[attrs[0]][attrs[1]];
					} else {
						callback(true, false);
					}
				} else {
					result = this.data[attrs[0]];
				}
				callback(null, result);
			} else {
				callback(true, false);
			}
		} else {
			callback(true, false);
		}
	}
}

module.exports = YahooWeather;
