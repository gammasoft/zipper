'use strict';

var express = require('express'),
    bodyParser = require('body-parser'),
    Aws = require('aws-sdk'),
    async = require('async'),
    prettyBytes = require('pretty-bytes'),
    tmp = require('tmp'),
    rimraf = require('rimraf'),
    request = require('request'),
    Debug = require('debug'),

    fs = require('fs'),
    path = require('path'),
    childProcess = require('child_process'),

    app = express(),
    debug = new Debug('zipper'),
    debugHttp = new Debug('zipper:http'),
    env = require('./env.json'),
    sqs = new Aws.SQS({
        params: {
            QueueUrl: env.queueUrl
        },
        apiVersion: '2012-11-05',
        region: env.region,
        accessKeyId: env.accessKeyId,
        secretAccessKey: env.secretAccessKey
    });

function emailNotification(options, callback) {
    return callback();
}

function httpNotification(options, callback) {
    var notification = options.notification,
        results = options.results,
        job = options.job;

    debug('Sending HTTP notification to "%s %s"', notification.method, notification.url);

    request({
        method: notification.method,
        url: notification.url,
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
}

var notificationTypes = {
    'http': httpNotification,
    'email': emailNotification
};

function processJob(job, callback) {
    debug('Processing job: %s - Attempt #%s', job.id, job.tries);

    var fileHeaders,
        temporaryDirectoryPath,
        compressedFilePath,
        compressedFileSize,
        uploadedFileLocation;

    var s3client = new Aws.S3({
        endpoint: 'https://s3-' + job.credentials.region + '.amazonaws.com',
        s3BucketEndpoint: false,

        accessKeyId: job.credentials.accessKeyId,
        secretAccessKey: job.credentials.secretAccessKey
    });

    job.files = job.files.map(function(key) {
        var key = key.split('/'),
            file = {
                fullKey: key.join('/'),
                bucket: key.shift(),
                key: key.join('/')
            };

        file.name = path.basename(file.key);
        return file;
    });

    job.destination = job.destination.split('/');
    job.destination = {
        fullKey: job.destination.join('/'),
        bucket: job.destination.shift(),
        key: job.destination.join('/')
    }

    job.destination.name = path.basename(job.destination.key);

    function getHeaders(cb) {
        debug('Downloading files headers...');

        async.mapSeries(job.files, function(file, cb) {
            debug('Downloading file headers from: %s', file.fullKey);

            s3client.headObject({
                Bucket: file.bucket,
                Key: file.key
            }, cb);
        }, function(err, headers) {
            if(err) {
                debug('Error downloading headers!');
                return cb(err);
            }

            fileHeaders = headers;
            cb();
        });
    }

    function checkFiles(cb) {
        debug('Checking files...');
        cb(null);
    }

    function createTemporaryDirectory(cb) {
        debug('Creating temporary directory');

        tmp.dir({
            prefix: 'zipper_'
        }, function temporaryDirectoryCreated(err, path, cleanup) {
            if(err) {
                debug('Error creating temporary directory!');
                return cb(err);
            }

            debug('Temporary directory created at %s', path);
            temporaryDirectoryPath = path;
            cb();
        });
    }

    function downloadFiles(cb) {
        debug('Downloading %s files...', job.files.length);

        async.eachSeries(job.files, function(file, cb) {
            debug('Downloading file: %s', file.fullKey);

            var fileDownload = s3client.getObject({
                Bucket: file.bucket,
                Key: file.key
            }).createReadStream();

            var writeStream = fs.createWriteStream(path.join(temporaryDirectoryPath, file.name));
            fileDownload.pipe(writeStream);

            var bytesReceived = 0;
            fileDownload.on('data', function(chunk) {
                bytesReceived += chunk.length;
                debug('Received %s', prettyBytes(bytesReceived));
            });

            fileDownload.on('end', function() {
                debug('Download completed!');
                cb();
            });
        }, function(err) {
            if(err) {
                debug('Error downloading files!');
                return cb(err);
            }

            debug('All downloads completed!');
            cb();
        });
    }

    function createCompressedFile(cb) {
        debug('Creating compressed file...');

        var zip = childProcess.spawn('zip', [
            '-r',
            job.destination.name,
            './'
        ], {
            cwd: temporaryDirectoryPath
        });

        zip.stdout.on('data', function(data) {
            debug('zip stdout', data.toString().trim());
        });

        zip.stderr.on('data', function() {
            debug('zip stderr', data.toString().trim());
        });

        zip.on('close', function(exitCode) {
            if(exitCode !== 0) {
                debug('Error creating compressed file! Zip exited with code %s', exitCode);
                cb(new Error('Zip exited with code: ' + exitCode));
            }

            compressedFilePath = path.join(temporaryDirectoryPath, job.destination.name);
            debug('Compressed file created!');
            cb();
        });
    }

    function getCompressedFileSize(cb) {
        debug('Getting compressed file size...');

        fs.stat(compressedFilePath, function(err, stats) {
            if(err) {
                debug('error getting compressed file size!');
                return cb(err);
            }

            compressedFileSize = stats.size;
            debug('Compressed file size is %s', prettyBytes(compressedFileSize));

            cb();
        });
    }

    function uploadCompressedFile(cb) {
        debug('Uploading file: %s', job.destination.fullKey);

        var upload = s3client.upload({
                Bucket: job.destination.bucket,
                Key: job.destination.key,
                ACL: job.acl || 'private',
                Body: fs.createReadStream(compressedFilePath)
            });

        upload.on('httpUploadProgress', debug);
        upload.send(function(err, data) {
            if(err) {
                debug('Error uploading file!');
                return cb(err);
            }

            uploadedFileLocation = data.Location;
            debug('File available at: %s', uploadedFileLocation);

            cb();
        });
    }

    function sendNotifications(cb) {
        if(!job.notifications || !job.notifications.length) {
            debug('No notifications to send...');
            return cb();
        }

        debug('Sending %s notifications...', job.notifications.length);
        async.eachSeries(job.notifications, function(notification, cb) {
            var notificationType = notification.type.toLowerCase(),
                notificationStrategy = notificationTypes[notificationType];

            if(!notificationStrategy) {
                debug('Unkown notification type "%s" - skiping...', notificationType);
                return cb();
            }

            notificationStrategy({
                job: job,
                notification: notification,
                results: {
                    location: uploadedFileLocation,
                    size: compressedFileSize,
                    status: 'success'
                }
            }, cb);
        }, cb);
    }

    function deleteJob(cb) {
        debug('Deleting job...');

        sqs.deleteMessage({
            ReceiptHandle: job.receipt
        }, cb);
    }

    function cleanUp(cb) {
        debug('Perfoming clean up...');
        rimraf(temporaryDirectoryPath, function(err) {
            if(err) {
                debug('Error removing temporary directory and files');
                throw err;
            }

            debug('Cleanup complete');
            cb();
        });
    }

    var startTime = new Date();
    async.series([
        getHeaders,
        checkFiles,
        createTemporaryDirectory,
        downloadFiles,
        createCompressedFile,
        getCompressedFileSize,
        uploadCompressedFile,
        sendNotifications,
        deleteJob
    ], function(err) {
        cleanUp(function() {
            if(err) {
                debug('Error processing job');
                debug(err);
                // TODO: Send notification on 5th attempt, indicating that job failed
                return callback(err);
            }

            debug('Job completed in: %s seconds', (new Date() - startTime) / 1000);
            callback();
        });
    });
}

function getNextJobs() {
    var longPoolingPeriod = 20,
        visibilityTimeout = 60 * 2.5,
        maxNumberOfMessages = 1,
        concurrentJobs = 1;

    debug('Long pooling for jobs. Timeout: %s seconds', longPoolingPeriod);

    sqs.receiveMessage({
        AttributeNames: [
            'ApproximateReceiveCount'
        ],
        MaxNumberOfMessages: maxNumberOfMessages,
        VisibilityTimeout: visibilityTimeout,
        WaitTimeSeconds: longPoolingPeriod
    }, function(err, data) {
        if(err) {
            debug('Error receiving messages!');
            throw err;
        }

        if(!data.Messages || !data.Messages.length) {
            debug('No jobs found...');
            return setImmediate(getNextJobs);
        }

        var messages = data.Messages.map(function(message) {
            var job = JSON.parse(message.Body);

            job.id = message.MessageId;
            job.receipt = message.ReceiptHandle;
            job.tries = message.Attributes.ApproximateReceiveCount;

            return job;
        });

        debug('Received %s jobs', messages.length);
        async.eachLimit(messages, concurrentJobs, processJob, function(err) {
            setImmediate(getNextJobs);
        });
    });
}

app.use(bodyParser.json({
    limit: '256kb'
}));

app.all('/echo', function(req, res, next) {
    debugHttp('Echoing request...');

    res.json({
        query: req.query,
        body: req.body
    });
});

app.post('/', function(req, res, next) {
    var job = req.body;

    if(!job.credentials || !job.credentials.accessKeyId || !job.credentials.secretAccessKey || !job.credentials.region) {
        return next(new Error('Credentials missing!'));
    }

    if(!job.files || !job.files.length) {
        return next(new Error('Files array is missing!'));
    }

    if(!job.destination) {
        return next(new Error('Destination key missing!'));
    }

    debugHttp('Job received, sending to queue...');
    sqs.sendMessage({
        MessageBody: JSON.stringify(job)
    }, function(err, data) {
        if(err) {
            debugHttp('Error sending job to queue!');
            return next(err);
        }

        debugHttp('Job sent to queue: %s', data.MessageId);
        res.status(202).json({
            id: data.MessageId
        });
    });
});

app.listen(9999);
getNextJobs();