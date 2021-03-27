import log from 'loglevel'
import { networks } from '../src/config'
import { run } from '../src/relay'

const alice = process.env.ALICE
if (alice === undefined) {
    throw new Error('Relay account $ALICE is not set')
}

if (process.env.DEBUG !== undefined) {
    log.setLevel('debug')
}

const etherscanApiKey = process.env.ETHERSCAN_API_KEY
if (etherscanApiKey === undefined) {
    throw new Error('Etherscan API key $ETHERSCAN_API_KEY is not set')
}

const networkName = process.env.NETWORK
if (networkName === undefined) {
    throw new Error('Network name $NETWORK is not set')
}

const network = networks[networkName]
if (network === undefined) {
    throw new Error(`Network ${networkName} is not supported`)
}

const proxy = process.env.HTTP_PROXY

run(network, {
    alice,
    etherscanApiKey,
    proxy
}).then(() => { }, (error) => {
    console.error(error)
    process.exit(1)
})
