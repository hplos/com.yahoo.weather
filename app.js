"use strict";
var request = require('request');
var geocoder = require('node-geocoder')('teleport', 'https');

// Celsius or Fahrenheit
var DEG = 'c';

var self = module.exports = {

	init: function () {

		// Ask Homey for current location
		Homey.manager('geolocation').getLocation(function (err, location) {

			// Get lat and lon
			var lat = location.latitude;
			var lon = location.longitude;

			// Create weather query for yahoo
			var wsql = 'select * from weather.forecast where woeid=WID and u="' + DEG + '"',
				weatherYQL = 'http://query.yahooapis.com/v1/public/yql?q=' + encodeURIComponent(wsql) + '&format=json';

			// Reverse encode lat lon to address information
			geocoder.reverse({lat: lat, lon: lon})
					.then(function (res) {

						// Make request to retrieve woeid of location
						request("http://where.yahooapis.com/v1/places.q('" + res[0].city + "')?format=json&appid=" + Homey.env.CLIENT_ID, function (err, response) {

							// Make request to fetch weather information from yahoo
							request(weatherYQL.replace('WID', JSON.parse(response.body).places.place[0].woeid), function (err, response) {
								console.log(JSON.parse(response.body).query.results.channel);
							});
						})
					})
					.catch(function (err) {
						console.log(err);
					});

		});
	}
};