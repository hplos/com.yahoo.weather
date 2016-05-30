'use strict';

const request = require('request-promise');
const geocoder = require('node-geocoder')('teleport', 'https');
const GoogleMapsAPI = require('googlemaps');

const googleMapsAPI = new GoogleMapsAPI({
	key: Homey.env.GOOGLE_API_KEY,
	stagger_time: 1000,
	encode_polylines: false,
	secure: true
});

class YahooWeather {

	constructor(options) {

		// Set defaults
		this.temp_metric = options.temp_metric;
		this.latitude = options.latitude;
		this.longitude = options.longitude;

		// These will be retrieved
		this.woeid = undefined;
		this.city = undefined;

		// Retrieve city name and woeid
		this._getWoeid();

		// Expose yahoo weather queries
		this.queries = function createQueries() {
			return {
				forecast: `select * from weather.forecast where woeid=${this.woeid} and u="${this.temp_metric}"`,
				current: `select item.condition from weather.forecast where woeid=${this.woeid}`,
			};
		};
	}

	_reverseGeoLocation(lat, lon) {
		return new Promise(function(resolve, reject){
			googleMapsAPI.reverseGeocode({
				"latlng": `${lat},${lon}`,
				"result_type": "locality",
				"language": "en",
				"location_type": "APPROXIMATE"
			}, function (err, data) {
				if(!err && data && data.results.length > 0){
					resolve(data.results[0].address_components[0].long_name)
				} else {
					reject()
				}
			});
		});
	}

	_convertCityToWoeid(city) {

		// Make request to retrieve woeid of location
		return request(`http://where.yahooapis.com/v1/places.q('${city}')?format=json&appid=${Homey.env.YAHOO_CLIENT_ID}`);
	}

	_getWoeid() {

		// Do not re-fetch value if present
		if (this.woeid) return Promise.resolve(this.woeid);

		// Fetch woeid and return promise
		return new Promise((resolve, reject) => {

			// First reverse lat long to a city name
			this._reverseGeoLocation(this.latitude, this.longitude)
				.then((res) => {

					// Store city name
					this.city = res;

					// Covert city name to woeid
					this._convertCityToWoeid(this.city)
						.then((res) => {

							// Store woeid
							this.woeid = JSON.parse(res).places.place[0].woeid;

							// Resolve promise
							resolve(this.woeid);
						})
						.catch((err) => {
							console.error(`Error converting city to woeid: ${err}`);

							// Failed
							reject(err);
						});
				})
				.catch((err) => {
					console.error(`Error reversing geo location: ${err}`);

					// Failed
					reject(err);
				});
		});
	}

	_queryYahooAPI(weatherYQL) {

		// Make request to fetch weather information from yahoo
		return request(weatherYQL);
	}

	getConditionMetadata(code) {
		console.log(code);
		// Get metadata belonging to weather code
		return yahooConditions[(code === '3200') ? 48 : code]
	}

	fetchData() {

		// Return promise
		return new Promise((resolve, reject) => {

			// Make sure woeid is set
			this._getWoeid().then(() => {

				// Make the weather api request
				this._queryYahooAPI('http://query.yahooapis.com/v1/public/yql?q=' + encodeURIComponent(this.queries().forecast) + '&format=json')
					.then((data) => {
						let jsonData = JSON.parse(data);

						// If no data provided, try again
						if (!jsonData.query.results) {

							// Make the weather api request
							this._queryYahooAPI('http://query.yahooapis.com/v1/public/yql?q=' + encodeURIComponent(this.queries().forecast) + '&format=json')
								.then((data) => {

									// Resolve with data
									resolve(JSON.parse(data).query.results);
								})
								.catch((err) => {

									// Reject
									reject(err);
								});
						}
						else {

							// Resolve with data
							resolve(JSON.parse(data).query.results);
						}
					})
					.catch((err) => {

						// Reject
						reject(err);
					});
			})
				.catch((err) => {

					// Reject
					reject(err);
				});
		});
	}
}

const yahooConditions = [
	{
		'index': 0,
		'type': 'tornado',
		'quantity': undefined,
		'text': {
			'singular': 'tornado',
			'plural': 'tornados',
		},
	},
	{
		'index': 1,
		'type': 'tropical storm',
		'quantity': undefined,
		'text': {
			'singular': 'tropical storm',
			'plural': 'tropical storms',
		},
	},
	{
		'index': 2,
		'type': 'huricane',
		'quantity': undefined,
		'text': {
			'singular': 'huricane',
			'plural': 'huricanes',
		},
	},
	{
		'index': 3,
		'type': 'severe thunderstorms',
		'quantity': 'severe',
		'text': {
			'singular': 'thunderstorm',
			'plural': 'thunderstorms',
		},
	},
	{
		'index': 4,
		'type': 'thunderstorm',
		'quantity': 'severe',
		'text': {
			'singular': 'thunderstorm',
			'plural': "thunderstorm's",
		},
	},
	{
		'index': 5,
		'type': 'rain and snow',
		'quantity': 'mixed',
		'text': {
			'singular': 'rain and snow',
			'plural': undefined,
		},
	},
	{
		'index': 6,
		'type': 'rain and sleet',
		'quantity': 'mixed',
		'text': {
			'singular': 'rain and sleet',
			'plural': undefined,
		},
	},
	{
		'index': 7,
		'type': 'snow and sleet',
		'quantity': 'mixed',
		'text': {
			'singular': 'snow and sleet',
			'plural': undefined,
		},
	},
	{
		'index': 8,
		'type': 'freezing drizzle',
		'quantity': undefined,
		'text': {
			'singular': 'freezing drizzle',
			'plural': undefined,
		},
	},
	{
		'index': 9,
		'type': 'drizzle',
		'quantity': undefined,
		'text': {
			'singular': 'drizzle',
			'plural': undefined,
		},
	},
	{
		'index': 10,
		'type': 'freezing rain',
		'quantity': undefined,
		'text': {
			'singular': 'freezing rain',
			'plural': undefined,
		},
	},
	{
		'index': 11,
		'type': 'shower',
		'quantity': undefined,
		'text': {
			'singular': 'shower',
			'plural': 'showers',
		},
	},
	{
		'index': 12,
		'type': 'shower',
		'quantity': undefined,
		'text': {
			'singular': 'shower',
			'plural': 'showers',
		},
	},
	{
		'index': 13,
		'type': 'snow flurry',
		'quantity': undefined,
		'text': {
			'singular': 'snow flurry',
			'plural': 'snow flurries',
		},
	},
	{
		'index': 14,
		'type': 'snow shower',
		'quantity': 'light',
		'text': {
			'singular': 'snow shower',
			'plural': 'snow showers',
		},
	},
	{
		'index': 15,
		'type': 'blowing snow',
		'quantity': undefined,
		'text': {
			'singular': 'blowing snow',
			'plural': 'blowing snow',
		},
	},
	{
		'index': 16,
		'type': 'snow',
		'quantity': undefined,
		'text': {
			'singular': 'snow',
			'plural': 'snow',
		},
	},
	{
		'index': 17,
		'type': 'hail',
		'quantity': undefined,
		'text': {
			'singular': 'hail',
			'plural': 'hail',
		},
	},
	{
		'index': 18,
		'type': 'sleet',
		'quantity': undefined,
		'text': {
			'singular': 'sleet',
			'plural': undefined,
		},
	},
	{
		'index': 19,
		'type': 'dust',
		'quantity': undefined,
		'text': {
			'singular': 'dust',
			'plural': undefined,
		},
	},
	{
		'index': 20,
		'type': 'fog',
		'quantity': undefined,
		'text': {
			'singular': 'foggy',
			'plural': undefined,
		},
	},
	{
		'index': 21,
		'type': 'haze',
		'quantity': undefined,
		'text': {
			'singular': 'haze',
			'plural': undefined,
		},
	},
	{
		'index': 22,
		'type': 'smoke',
		'quantity': undefined,
		'text': {
			'singular': 'smoky',
			'plural': undefined,
		},
	},
	{
		'index': 23,
		'type': 'wind',
		'quantity': undefined,
		'text': {
			'singular': 'blustery',
			'plural': 'strong winds',
		},
	},
	{
		'index': 24,
		'type': 'wind',
		'quantity': undefined,
		'text': {
			'singular': 'windy',
			'plural': undefined,
		},
	},
	{
		'index': 25,
		'type': 'cold',
		'quantity': undefined,
		'text': {
			'singular': 'cold',
			'plural': undefined,
		},
	},
	{
		'index': 26,
		'type': 'clouds',
		'quantity': undefined,
		'text': {
			'singular': 'cloudy',
			'plural': 'clouds',
		},
	},
	{
		'index': 27,
		'type': 'clouds',
		'quantity': 'mostly',
		'text': {
			'singular': 'cloudy night',
			'plural': undefined,
		},
	},
	{
		'index': 28,
		'type': 'clouds',
		'quantity': 'mostly',
		'text': {
			'singular': 'cloudy day',
			'plural': undefined,
		},
	},
	{
		'index': 29,
		'type': 'clouds',
		'quantity': 'partly',
		'text': {
			'singular': 'cloudy night',
			'plural': undefined,
		},
	},
	{
		'index': 30,
		'type': 'clouds',
		'quantity': 'partly',
		'text': {
			'singular': 'cloudy day',
			'plural': undefined,
		},
	},
	{
		'index': 31,
		'type': 'clear',
		'quantity': undefined,
		'text': {
			'singular': 'clear night',
			'plural': undefined,
		},
	},
	{
		'index': 32,
		'type': 'sun',
		'quantity': undefined,
		'text': {
			'singular': 'sunny',
			'plural': undefined,
		},
	},
	{
		'index': 33,
		'type': 'fair',
		'quantity': undefined,
		'text': {
			'singular': 'fair night',
			'plural': undefined,
		},
	},
	{
		'index': 34,
		'type': 'fair',
		'quantity': undefined,
		'text': {
			'singular': 'fair day',
			'plural': undefined,
		},
	},
	{
		'index': 35,
		'type': 'rain and hail',
		'quantity': 'mixed',
		'text': {
			'singular': 'rain and hail',
			'plural': undefined,
		},
	},
	{
		'index': 36,
		'type': 'hot',
		'quantity': undefined,
		'text': {
			'singular': 'hot',
			'plural': undefined,
		},
	},
	{
		'index': 37,
		'type': 'thunderstorm',
		'quantity': undefined,
		'text': {
			'singular': 'isolated thunderstorm',
			'plural': 'isolated thunderstorms',
		},
	},
	{
		'index': 38,
		'type': 'thunderstorm',
		'quantity': undefined,
		'text': {
			'singular': 'scattered thunderstorm',
			'plural': 'scattered thunderstorms',
		},
	},
	{
		'index': 39,
		'type': 'thunderstorm',
		'quantity': undefined,
		'text': {
			'singular': 'scattered thunderstorm',
			'plural': 'scattered thunderstorms',
		},
	},
	{
		'index': 40,
		'type': 'shower',
		'quantity': undefined,
		'text': {
			'singular': 'scattered shower',
			'plural': 'scattered showers',
		},
	},
	{
		'index': 41,
		'type': 'snow',
		'quantity': 'heavy',
		'text': {
			'singular': 'heavy snow',
			'plural': undefined,
		},
	},
	{
		'index': 42,
		'type': 'snow',
		'quantity': undefined,
		'text': {
			'singular': 'scattered snow shower',
			'plural': 'cattered snow showers',
		},
	},
	{
		'index': 43,
		'type': 'snow',
		'quantity': 'heavy',
		'text': {
			'singular': 'heavy snow',
			'plural': undefined,
		},
	},
	{
		'index': 44,
		'type': 'clouds',
		'quantity': 'partly',
		'text': {
			'singular': 'partly clouded',
			'plural': undefined,
		},
	},
	{
		'index': 45,
		'type': 'thundershowers',
		'quantity': undefined,
		'text': {
			'singular': 'thundershowers',
			'plural': undefined,
		},
	},
	{
		'index': 46,
		'type': 'snow',
		'quantity': undefined,
		'text': {
			'singular': 'snow shower',
			'plural': 'snow showers',
		},
	},
	{
		'index': 47,
		'type': 'thundershowers',
		'quantity': undefined,
		'text': {
			'singular': 'isolated thundershower',
			'plural': 'isolated thundershowers',
		},
	},
	{
		'index': 3200,
		'type': 'unavailable',
		'quantity': undefined,
		'text': {
			'singular': 'unavailable',
			'plural': undefined,
		},
	},
];

module.exports = YahooWeather;
