'use strict';

var express = require('express'),
    bodyParser = require('body-parser'),
    Aws = require('aws-sdk'),
    async = require('async'),
    archiver = require('archiver'),
    Debug = require('debug'),

    app = express(),
    debug = new Debug('zipper'),
    busy = false,
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

app.use(bodyParser.json({
    limit: '256kb'
}));

function processJob(job) {
    busy = true;
    debug('Processando: %s', job.id);

    var s3client = new Aws.S3({
        endpoint: 'https://s3-' + job.credentials.region + '.amazonaws.com',
        s3BucketEndpoint: false,

        accessKeyId: job.credentials.accessKeyId,
        secretAccessKey: job.credentials.secretAccessKey
    });

    function getHeads(cb) {
        debug('Obtendo dados dos arquivos...');
        debug('Quantidade de arquivos: %s', job.keys.length);

        async.mapSeries(job.keys, function(key, cb) {
            debug('Obtendo dados do arquivo: %s', key);

            key = key.split('/');
            s3client.headObject({
                Bucket: key.shift(),
                Key: key.join('/')
            }, cb);
        }, cb);
    }

    function checkFiles(heads, cb) {
        debug('Verificando arquivos...');
        // TODO: Implement file size verification logic
        cb(null, heads);
    }

    function createZipFile(heads, cb) {
        if(typeof heads === 'function') {
            cb = heads;
            heads = [];
        }

        cb(null, archiver('zip'));
    }

    function downloadFiles(zip, cb) {
        zip.on('error', cb);

        async.eachSeries(job.keys, function(key, cb) {
            debug('Baixando o arquivo: %s', key);

            key = key.split('/');
            var objectStream = s3client.getObject({
                Bucket: key.shift(),
                Key: key.join('/')
            }).createReadStream();

            zip.append(objectStream, {
                name: key.join('/')
            });

            var bytesReceived = 0;
            objectStream.on('data', function(chunk) {
                bytesReceived += chunk.length;

                function formatBytes(bytes) {
                    if(bytes > 1024 * 1024) {
                        return (bytes / 1024 / 1024).toFixed(2) + 'Mb';
                    }

                    if(bytes > 1024) {
                        return (bytes / 1024).toFixed(2) + 'Kb';
                    }

                    return bytes + 'b';
                }

                debug('Received %s', formatBytes(bytesReceived));
            });

            objectStream.on('end', function() {
                debug('Download concluído!');
                cb();
            });
        }, function(err) {
            if(err) {
                return cb(err);
            }

            zip.finalize();
            cb(null, zip);
        });
    }

    function uploadZipFile(zip, cb) {
        debug('Enviando arquivo: %s', job.destinationKey);

        var key = job.destinationKey.split('/'),
            upload = s3client.upload({
                Bucket: key.shift(),
                Key: key.join('/'),
                ACL: job.acl || 'private',
                Body: zip
            });

        upload.on('httpUploadProgress', debug);
        upload.send(cb);
    }

    function sendNotifications(data, cb) {
        debug('Arquivo disponível em: %s', data.Location);

        if(job.notifications && job.notifications.length) {
            // TODO: Not Implemented
            // Enviar job.id e data.Location
        } else {
            debug('Nenhuma notificação para enviar');
        }

        cb();
    }

    function deleteJob(cb) {
        debug('Deletando job...');

        sqs.deleteMessage({
            ReceiptHandle: job.deleteId
        }, cb);
    }

    var startTime = new Date();
    async.waterfall([
        // getHeads,
        // checkFiles,
        createZipFile,
        downloadFiles,
        uploadZipFile,
        sendNotifications,
        deleteJob
    ], function(err) {
        if(err) {
            throw err;
        }

        busy = false;
        debug('Job concluido em: %s segundos', (new Date() - startTime) / 1000);
        setImmediate(getNext);
    });
}

function getNext() {
    debug('Obtendo jobs...');

    sqs.receiveMessage({
        AttributeNames: [
            'ApproximateFirstReceiveTimestamp',
            'ApproximateReceiveCount'
        ],
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 60,
        WaitTimeSeconds: 20
    }, function(err, data) {
        if(err) {
            throw err;
        }

        if(!data.Messages || !data.Messages.length) {
            debug('Nenhum job...');
            return setImmediate(getNext);
        }

        var message = data.Messages[0],
            job = JSON.parse(message.Body);

        job.id = message.MessageId;
        job.deleteId = message.ReceiptHandle;
        processJob(job);
    });
}

getNext();

app.post('/', function(req, res, next) {
    var job = req.body;

    if(!job.credentials || !job.credentials.accessKeyId || !job.credentials.secretAccessKey || !job.credentials.region) {
        return next(new Error('Credentials missing!'));
    }

    if(!job.keys || !job.keys.length) {
        return next(new Error('Keys missing!'));
    }

    if(!job.destinationKey) {
        return next(new Error('Destination key missing!'));
    }

    sqs.sendMessage({
        MessageBody: JSON.stringify(job)
    }, function(err, data) {
        if(err) {
            return next(err);
        }

        res.status(202).json({
            id: data.MessageId
        });
    });
});

app.listen(9999);