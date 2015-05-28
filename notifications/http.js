'use strict';

var Debug = require('debug'),
    request = require('request'),

    debug = new Debug('zipper');

module.exports = function httpNotification(options, callback) {
    var notification = options.notification,
        results = options.results,
        job = options.job;

    debug('Sending HTTP notification to "%s %s"', notification.method.toUpperCase(), notification.url);

    request({
        method: notification.method,
        url: notification.url.replace(/{:id}/g, job.id),
        json: {
            id: job.id,
            status: results.status,
            location: results.location,
            size: results.size
        }
    }, function(err, res, body) {
        if(err) {
            debug('Error sending HTTP notification');
            return callback(err);
        }

        debug('Notification sent, status code: %s', res.statusCode);
        if(res.statusCode === 200) {
            debug('Response was successful, response body:');
            debug(body);
        }

        callback(null, res.statusCode);
    });
};