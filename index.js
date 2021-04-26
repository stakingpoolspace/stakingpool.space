const axios = require('axios')
const bluebird = require('bluebird')
const cheerio = require('cheerio')
const circularJson = require('circular-json')
const cors = require('cors')
const express = require('express')
const limiter = require('express-limiter')
const redis = require('redis')
const Web3 = require('web3')

const { liquidityProtectionInterface } = require('./liquidityProtection-abi.js')
const { liquidityPoolInterface } = require('./liquidityPool-abi.js')
const { vortexConverterInterface } = require('./vortexConverter-abi.js')
const { vortexBurnInterface } = require('./vortexBurner-abi.js')
const { bancorPool } = require('./bancorPool.js')
const { tokenAddress } = require('./tokenAddress.js')
const { erc20Interface } = require('./erc20-abi.js')

const infuraAPI = 'your https://infura.io/ API key';
const bancorLiquidityProtection = '0x42743F4d9f139bfD04680Df50Bce2d7Dd8816F90'
const bancorVortexBurn = '0x2f87b1fca1769BC3361700078e1985b2Dc0f1142'

const app = express()
bluebird.promisifyAll(redis)
const redisClient = redis.createClient(6379)
const limiterClient = limiter(app, redisClient)

limiterClient({
    path: ['/api/bancor/:token', '/api/bancor/vortex/rate/:token', '/api/defipulse/:category/rank/:project', '/api/bancor/vortex/burn/vbnt'],
    method: 'get',
    // lookup: ['originalUrl', 'headers.x-forwarded-for'],
    lookup: function(req, res, opts, next) {
        opts.lookup = ['originalUrl', 'headers.x-forwarded-for']
        opts.expire = getSeconds(req) * 1000
        return next()
    },
    total: 2,
    // expire: 60 * 1000,
    onRateLimited: (req, res) => {
        const seconds = getSeconds(req)
        res.status(429).json({
            'status' : '429',
            'message' : 'Too many requests! This API call result is cached for ' + seconds + ' seconds, so please limit your calls to once per ' + seconds + ' seconds.',
        })
    }
})

const corsOptions = {
    optionsSuccessStatus: 200, // For legacy browser support
    methods: "GET",
}

app.use(cors(corsOptions))

const web3 = new Web3(infuraAPI);
const bancorLiquidityProtectionContract = new web3.eth.Contract(liquidityProtectionInterface, bancorLiquidityProtection);
const bancorVortexLiquidityPoolContract = new web3.eth.Contract(liquidityPoolInterface, bancorPool['vbnt'])
const bancorVortexBurnContract = new web3.eth.Contract(vortexBurnInterface, bancorVortexBurn);

async function getAvailableSpaceForBaseToken(pool) {
    return bancorLiquidityProtectionContract.methods.poolAvailableSpace(pool).call()
        .then(spaces => spaces[0])
        .then(space => web3.utils.fromWei(space))
        .then(space => +parseFloat(space).toFixed(2))
}

async function getVortexExchangeRate(token) {
    let rate = await getRate(token)
    return +parseFloat(rate).toFixed(6)
}

async function getRate(token) {
    const bancorVortexConverter = await getVortexConverter()
    const bancorVortexConverterContract = new web3.eth.Contract(vortexConverterInterface, bancorVortexConverter)
    
    const balances = await bancorVortexConverterContract.methods.reserveBalances().call()
    const bntBalance = balances[0]
    const vbntBalance = balances[1]

    if (token === 'vbnt') {
        return bntBalance / vbntBalance
    } else if (token === 'bnt') {
        return vbntBalance / bntBalance
    }
}

async function getVortexConverter() {
    const key = 'vortexConverter'
    let vortexConverter = await redisClient.getAsync(key)

    if (vortexConverter) return vortexConverter

    vortexConverter = await bancorVortexLiquidityPoolContract.methods.owner().call()
    setToCache(key, vortexConverter, 60)
    return vortexConverter
}

async function getVortexBurn() {
    return bancorVortexBurnContract.methods.totalBurnedAmount().call()
        .then(value => web3.utils.fromWei(value))
        .then(value => +parseFloat(value).toFixed(2))
}

async function getTotalSupply(token) {
    const address = tokenAddress[token]
    const contract = new web3.eth.Contract(erc20Interface, address)
    return contract.methods.totalSupply().call()
        .then(value => web3.utils.fromWei(value))
        .then(value => +parseFloat(value).toFixed(2))
}

function respondFromCache(req, res, next, messageKey) {
    redisClient.get(req.originalUrl, (error, data) => {
        if (error) res.status(400).send(error)
        if (data) sendJsonData(res, messageKey, data, getSeconds(req))
        else next()
    })
}

function getSeconds(req) {
    const token = req.originalUrl.split('/').pop()
    return getSecondsForToken(token)
}

function getSecondsForToken(token) {
    if (['eth', 'link', 'vbnt', 'bnt'].includes(token)) {
        return 10
    }
    return 60
}

function setToCache(key, value, expire = 0) {
    if (expire == 0) redisClient.set(key, value)
    else redisClient.setex(key, expire, value)
}

function sendJsonData(res, key, value, seconds) {
    res.status(200).json({
        'status' : '200', 
        [key] : value,
        'message' : 'This API call result is cached for ' + seconds + ' seconds, so please limit your calls to once per ' + seconds + ' seconds.',
    })
}

function tokenNotSupported(res) {
    res.status(404).json({
        'status' : '404',
        'message' : 'Token not supported',
    })
}

app.get("/api/bancor/:token", 
(req, res, next) => respondFromCache(req, res, next, 'space'), 
async (req, res) => {
    const token = req.params.token;
    const tokenAddress = bancorPool[token]
    
    if (tokenAddress) {
        const space = await getAvailableSpaceForBaseToken(tokenAddress)
        const seconds = getSecondsForToken(token)
        setToCache(req.originalUrl, space, seconds)
        sendJsonData(res, 'space', JSON.stringify(space), seconds)
    } else {
        tokenNotSupported(res)
    }
});

app.get("/api/bancor/vortex/rate/:token", 
(req, res, next) => respondFromCache(req, res, next, 'rate'), 
async (req, res) => {
    const token = req.params.token

    if (['vbnt', 'bnt'].includes(token)) {
        const rate = await getVortexExchangeRate(token)
        const seconds = getSecondsForToken(token)
        setToCache(req.originalUrl, rate, seconds)
        sendJsonData(res, 'rate', JSON.stringify(rate), seconds)
    } else {
        tokenNotSupported(res)
    }
});

app.get("/api/bancor/vortex/burn/vbnt", 
(req, res, next) => respondFromCache(req, res, next, 'burned'), 
async (req, res) => {
    const burned = await getVortexBurn()
    const seconds = getSeconds(req)
    setToCache(req.originalUrl, burned, seconds)
    sendJsonData(res, 'burned', JSON.stringify(burned), seconds)
});

app.get("/api/totalsupply/vbnt", 
(req, res, next) => respondFromCache(req, res, next, 'totalSupply'), 
async (req, res) => {
    const totalSupply = await getTotalSupply('vbnt')
    const seconds = getSeconds(req)
    setToCache(req.originalUrl, totalSupply, seconds)
    sendJsonData(res, 'totalSupply', JSON.stringify(totalSupply), seconds)
});

app.get("/api/defipulse/:category/rank/:project", 
(req, res, next) => respondFromCache(req, res, next, 'rank'), 
async (req, res) => {
    try {
        const project = req.params.project.toLowerCase()
        const category = req.params.category.toLowerCase()
        const result = await axios.get('https://defipulse.com/')
        const text = circularJson.stringify(result)
        const $ = cheerio.load(text)
        let projectNames = []

        for (row of $('tbody tr')) {
            const columns = $(row).find('td')
            const projectName = $(columns[2]).text().toLowerCase()
            const projectCategory = $(columns[4]).text().toLowerCase()

            if (projectCategory === category || category === 'all') {
                projectNames.push(projectName)
            }

            if (projectName === project) {
                if (projectCategory !== category && category !== 'all') {
                    projectNames = []
                }
                break
            }
        }

        const rank = projectNames.indexOf(project) + 1
        const seconds = getSeconds(req)
        setToCache(req.originalUrl, rank, seconds)
        sendJsonData(res, 'rank', JSON.stringify(rank), seconds)
    } catch (err) {console.log(err)}
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
