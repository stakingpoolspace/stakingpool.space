# stakingpool.space
A Node Express server to run the Web3js library to interact with the Ethereum blockchain. In this case used to retrieve the available pool space of the Bancor staking pools for Ethereum, Chainlink, and vBNT. Also to get the exchange rate between vBNT and BNT in the Vortex pool.

## Setup
1. You'll need to install Nodejs on your local machine or server (depending on where you want to run the code). Try
   ```bash
   node -v
   ```
   first on your command line to see if you already have Nodejs. Otherwise download it at https://nodejs.org/en/download/.
2. Clone this repo and put it in a folder. Go to the folder containing the code on the command line and run
   ```bash
   npm install
   ```
   (npm comes along with Nodejs). This should create a folder 'node_modules'.
3. I use Redis to cache API call results for 10 seconds. If you don't want to use caching, remove the functions 'respondFromCache' and 'setToCache' from index.js (and don't forget to remove the function calls). Otherwise download and install Redis. ([Follow this guide for Windows.](https://redislabs.com/blog/redis-on-windows-10/))

   I run Redis in a Docker container on my server and have a firewall rule that blocks all external calls on port 6379.
4. Create a free account on https://infura.io and use your API key as 'const infuraAPI' in index.js.
5. You should be all set to go. On the command line (in the folder with the code), run
   ```bash
   npm start
   ```
   and you should see the message 'Listening on port 3000'. On a server you'll need to create a reverse proxy pointing a domain address to localhost:3000.
6. You can test your local setup by running the following command on the command line:
   ```bash
   curl http://localhost:3000/api/bancor/eth
   ```
