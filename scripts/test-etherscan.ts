import { NetworkDescription, networks } from '../src/config'
import { EtherscanClient } from '../src/ethereum/etherscan'

const apiKey = process.env.API_KEY
if (apiKey === undefined) {
    throw new Error('No API key found in environment variables')
}

const networkName = process.env.NETWORK
if (networkName === undefined) {
    throw new Error('No network name found in environment variables')
}

const network: NetworkDescription | undefined = networks[networkName]
if (network === undefined) {
    throw new Error(`Network ${networkName} is not supported`)
}

const client = new EtherscanClient(apiKey, network.etherscanApiBase, process.env.HTTP_PROXY)

async function followTransactions(contractHeight: number, contract: string): Promise<void> {
    let chainHeight = 0
    try {
        chainHeight = await client.readHeight()
        console.info(`Current Ethereum height: ${chainHeight}`)
    } catch (reason) {
        console.error(`readHeight ERROR: ${reason as string}`)
    }

    console.info(`Will read Ethereum transactions from block ${contractHeight} to ${chainHeight}`)

    const iterator = client.readTokenTx(chainHeight, contractHeight, contract)
    let totalTx = 0
    while (true) {
        const transactions = await iterator.next()
        if (transactions.done ?? true) {
            break
        }
        console.info(`Read ${transactions.value.length} transactions`)
        totalTx += transactions.value.length
    }

    console.info(`Read total ${totalTx} transactions`)
}

followTransactions(network.contractHeight, network.contract).then(() => { }).catch((reason) => { console.error(reason) })
