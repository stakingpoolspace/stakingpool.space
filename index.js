const cors = require('cors');
const express = require('express');
const limiter = require('express-limiter');
const redis = require('redis');
const Web3 = require('web3');

const { jsonInterface } = require('./abi.js');
const { bancorPool } = require('./bancorPool.js');

const infuraAPI = 'your https://infura.io/ API key';
const bancorLiquidityPool = '0xeead394a017b8428e2d5a976a054f303f78f3c0c';

const app = express();
const redisClient = redis.createClient(6379);
const limiterClient = limiter(app, redisClient);

limiterClient({
    path: '/api/bancor/:token',
    method: 'get',
    lookup: ['url', 'headers.x-forwarded-for'],
    total: 2,
    expire: 10 * 1000,
    onRateLimited: (req, res) => 
        res.status(429).json({
            'status' : '429',
            'message' : 'Too many requests! API call results are cached for 10 seconds, so please limit your calls to once per 10 seconds.',
        })
})

var corsOptions = {
    optionsSuccessStatus: 200, // For legacy browser support
    methods: "GET",
}

app.use(cors(corsOptions))

var web3 = new Web3(infuraAPI);
var bancorLiquidityPoolContract = new web3.eth.Contract(jsonInterface, bancorLiquidityPool);

async function getAvailableSpaceForBaseToken(pool) {
    return bancorLiquidityPoolContract.methods.baseTokenAvailableSpace(pool).call()
        .then(value => web3.utils.fromWei(value))
        .then(value => +parseFloat(value).toFixed(2))
}

function setOnRedis(key, value, expire = 0) {
    if (expire == 0) {
        redisClient.set(key, value)
    } else {
        redisClient.setex(key, expire, value)
    }
}

function sendJsonData(res, amount) {
    res.status(200).json({
        'status' : '200', 
        'space' : amount,
        'message' : 'API call results are cached for 10 seconds, so please limit your calls to once per 10 seconds.',
    })
}

function getFromRedis(req, res, next) {
    redisClient.get(req.originalUrl, (error, data) => {
        if (error) res.status(400).send(error);
        if (data !== null) sendJsonData(res, data);
        else next();
    })
}

app.get("/api/bancor/:token", getFromRedis, async (req, res) => {
    let amount = await getAvailableSpaceForBaseToken(bancorPool[req.params.token])
    setOnRedis(req.originalUrl, amount, 10)
    sendJsonData(res, JSON.stringify(amount))
});

app.use(function (err, req, res, next) {
    // console.error(err.stack)
    res.status(400).send('Something went wrong')
});

redisClient.on("error", function(err) {
    console.error("Error connecting to redis", err);
});

var server = app.listen(3000, function() {
    console.log('Listening on port %d', server.address().port)
});
