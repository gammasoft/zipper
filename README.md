# zipper

Simple compression service for Amazon S3

### Introduction

Zipper is a HTTP rest API that will allow you to compress files from your Amazon S3 buckets into a `.zip` file. The resulting `.zip` file is then uploaded to Amazon S3.

### Pre-requirements

1. A queue at Amazon SQS service so its easier to scale up.
2. An Amazon EC2 instance (the more RAM it has the more files you'll be able to zip) - currently zipper processes all in memory - this will be changed.

### Installation

1. Clone this repo on your Amazon EC2 instance `git clone https://github.com/gammasoft/zipper.git`
2. Install dependencies: `cd zipper && npm install`
3. Create a configuration file like this (replace with your specific values) and put it beside `index.js`:
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

Send `POST` requests yo your Amazon EC2 instance IP at port `9999` with the follwoing payload:

```json
{
  "credentials": {
    "accessKeyId": "AKIA13222BSG6O67WUAA",
    "secretAccessKey": "M8kdoopL/GZ8n7Qgak9OC8/81kfLv7ptG7JnZAFM",
    "region": "sa-east-1"
  },
  "keys": [
    "yourCoolBucket/keyToAFile.xml",
    "yourCoolBucket/keyToAnotherFile.xml",
    "yourSecondBucket/theBestFileInTheWorld.pdf",
  ],
  "destinationKey": "myThirdBucket/everything.zip"
}
```

**Note that** all buckets must be in the same region of your credentials!

**ITS ADVISABLE THAT YOU CREATE SPECIFIC ACCESS CREDENTIALS TO USE WITH ZIPPER. GIVE THEM RESTRICTED ACCESS!**

### Roadmap

1. Manipulate the resulting `.zip` file in disk, which is cheaper than ram.
2. Implement notifications/hooks (smtp/http)
3. Implement size filters (e.g. *do not allow resulting files bigger than X, or individual files bigger than Y*)

### Contributions

1. Pull requests are welcome
2. Open issue tickets whenever you fell its appropriate
3. Send bitcoin for beer at: **1KP1Fthgkh9TSovkxCMY1wUm3zWpfnuxro**

### License MIT



