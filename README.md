# zipper

Simple compression service for Amazon S3

### Introduction

Zipper is a HTTP rest API that will allow you to compress files from your Amazon S3 buckets into a `.zip` file. The resulting `.zip` file is then uploaded to Amazon S3.

You can also configure notification hooks to know when your file is ready.

### Pre-requirements

1. A queue at Amazon SQS service so its easier to scale up.
2. An Amazon EC2 instance - can be a micro one.

### Installation

1. Clone this repo on your Amazon EC2 instance with `git clone https://github.com/gammasoft/zipper.git --branch v1.0.5 --depth 1` (*replace for the latest version number*)
2. Install dependencies: `cd zipper && npm install`
3. Create a configuration file like this (replace with your specific values), call it `env.json` and put it beside `index.js`:
```json
{
    "queueUrl": "https://sqs.sa-east-1.amazonaws.com/123412341234/yourQueueForZipper",
    "region": "us-east-1",
    "accessKeyId": "AKIAJ2E1423G6O67WUAA",
    "secretAccessKey": "M8sj0opL/GZ8n7Qgak9OC8/81kfLv7ptG7JnZAFM"
}
```
4. Run `node index.js` (or use forever/pm2 to survive hiccups)

### Usage

Send `POST` requests yo your Amazon EC2 instance IP at port `9999` with the following payload:

```json
{
  "credentials": {
    "accessKeyId": "AKIA13222BSG6O67WUAA",
    "secretAccessKey": "M8kdoopL/GZ8n7Qgak9OC8/81kfLv7ptG7JnZAFM",
    "region": "sa-east-1"
  },
  "files": [
    "yourCoolBucket/keyToAFile.xml",
    "yourCoolBucket/keyToAnotherFile.xml",
    "yourSecondBucket/theBestFileInTheWorld.pdf",
  ],
  "notifications": [{
    "type": "http",
    "method": "post",
    "url": "http://example.com/update-zip-status?id={:id}"
  }],
  "destination": "myThirdBucket/everything.zip",
  "acl": "private"
}
```

**Note that** `acl` parameter is optional and defaults to `private`.

You will be provided a response `202 - Accepted` containing a job id that will uniquely identify your compression job. It is useful to save this value when using http hooks/notifications to later identify which job has finished. This is what the response data looks like:

```json
{
    "id": "48926954-2bc2-479a-9a73-9f84a69dabd1"
}
```

**Note that** all buckets must be in the same region of your credentials!

**ITS ADVISABLE THAT YOU CREATE SPECIFIC ACCESS CREDENTIALS TO USE WITH ZIPPER, AND GIVE THEM RESTRICTED ACCESS!**

### Notifications

Only HTTP notifications are implemented so far. You can pass any url/method, and if your url contains the id placeholder `{:id}` then zipper will replace it with your job id therefore helping you identify which file is ready.

This is the payload sent with any HTTP notification:

```json
{
    "id": "48926954-2bc2-479a-9a73-9f84a69dabd1",
    "status": "success",
    "location": "http://s3-sa-east-1.amazons3.com/your-file.zip",
    "size": "43243"
}
```

**Where:**
- `id` is the same id returned when you first submited the job.
- `status` is either `success` or `failed` (zipper tries to execute your job 5 times before giving up).
- `location` is the Amazon S3 url for your compressed file
- `size` is the size in bytes of your resulting file

### Debugging

If you have any problems and need some debbuging then you should start zipper like this: `DEBUG=zipper,zipper:http node index.js`. This will print log messages that might be helpful.

### Roadmap

1. Implement email notifications
2. Implement size filters (e.g. *do not allow resulting files bigger than X, or individual files bigger than Y*)

### Contributions

1. Pull requests are welcome
2. Open issue tickets whenever you fell its appropriate
3. Send bitcoin for beer at: **1KP1Fthgkh9TSovkxCMY1wUm3zWpfnuxro**

### License MIT



