const cors = require('cors');
const express = require('express');
const limiter = require('express-limiter');
const redis = require('redis');
const Web3 = require('web3');

const { liquidityPoolInterface } = require('./liquidityPool-abi.js');
const { vortexInterface } = require('./vortexPoolConverter-abi.js');
const { bancorPool } = require('./bancorPool.js');

const infuraAPI = 'your https://infura.io/ API key';
const bancorLiquidityPool = '0xeead394a017b8428e2d5a976a054f303f78f3c0c';
const bancorVortexSwap = '0x3d9491f0C831c40F61A285BE4350a3A4c74e0027';

const app = express();
const redisClient = redis.createClient(6379);
const limiterClient = limiter(app, redisClient);

limiterClient({
    path: '/api/bancor/*',
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
var bancorLiquidityPoolContract = new web3.eth.Contract(liquidityPoolInterface, bancorLiquidityPool);
var bancorVortexSwapContract = new web3.eth.Contract(vortexInterface, bancorVortexSwap);

async function getAvailableSpaceForBaseToken(pool) {
    return bancorLiquidityPoolContract.methods.baseTokenAvailableSpace(pool).call()
        .then(value => web3.utils.fromWei(value))
        .then(value => +parseFloat(value).toFixed(2))
}

async function getVortexExchangeRate(token) {
    let rate = await getRate(token)
    return +parseFloat(rate).toFixed(6)
}

async function getRate(token) {
    let balances = await bancorVortexSwapContract.methods.reserveBalances().call()

    if (token === 'vbnt') {
        return balances[0] / balances[1]
    } else if (token === 'bnt') {
        return balances[1] / balances[0]
    }
}

function respondFromCache(req, res, next, messageKey) {
    redisClient.get(req.originalUrl, (error, data) => {
        if (error) res.status(400).send(error)
        if (data) sendJsonData(res, messageKey, data)
        else next()
    })
}

function setToCache(key, value, expire = 0) {
    if (expire == 0) redisClient.set(key, value)
    else redisClient.setex(key, expire, value)
}

function sendJsonData(res, key, value) {
    res.status(200).json({
        'status' : '200', 
        [key] : value,
        'message' : 'API call results are cached for 10 seconds, so please limit your calls to once per 10 seconds.',
    })
}

function tokenNotSupported(res) {
    res.status(404).json({
        'status' : '404',
        'message' : 'Token not supported',
    })
}

app.get("/api/bancor/:token", (req, res, next) => respondFromCache(req, res, next, 'space'), async (req, res) => {
    let tokenAddress = bancorPool[req.params.token]

    if (tokenAddress) {
        let space = await getAvailableSpaceForBaseToken(tokenAddress)
        setToCache(req.originalUrl, space, 10)
        sendJsonData(res, 'space', space)
    } else {
        tokenNotSupported(res)
    }
});

app.get("/api/bancor/vortex/rate/:token", (req, res, next) => respondFromCache(req, res, next, 'rate'), async (req, res) => {
    let token = req.params.token

    if (['vbnt', 'bnt'].includes(token)) {
        let rate = await getVortexExchangeRate(token)
        setToCache(req.originalUrl, rate, 10)
        sendJsonData(res, 'rate', rate)
    } else {
        tokenNotSupported(res)
    }
});

app.use(function (err, req, res, next) {
    console.error(err.stack)
    res.status(400).send('Something went wrong')
});

redisClient.on("error", function(err) {
    console.error("Error connecting to redis", err);
});

var server = app.listen(3000, function() {
    console.log('Listening on port %d', server.address().port)
});
