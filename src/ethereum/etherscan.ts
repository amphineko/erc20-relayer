import { hexToNumber } from '@polkadot/util'
import createHttpsProxyAgent from 'https-proxy-agent'
import HttpsProxyAgent from 'https-proxy-agent/dist/agent'
import fetch, { Response } from 'node-fetch'
import { stringify as makeQuerystring } from 'querystring'
import { URL } from 'url'

interface ProxyConfiguration {
    host: string
    port: number
    protocol: string
}

interface QueryResponse<T> {
    status: string
    message: string
    result: T
}

interface ProxyResponse {
    jsonrpc: '2.0'
    id: number
    result: string
}

export interface Transaction {
    blockNumber: string
    from: string
    hash: string
    value: string
}

export class NoTransactionError extends Error { }

const defaultPageSize = 500
const defaultRetries = 5

export class EtherscanClient {
    private readonly apiKey: string

    private readonly endpoint: string

    private readonly httpsAgent?: HttpsProxyAgent

    constructor(apiKey: string, endpoint: string, proxy?: ProxyConfiguration | string) {
        this.apiKey = apiKey
        this.endpoint = endpoint
        this.httpsAgent = proxy !== undefined ? createHttpsProxyAgent(proxy) : undefined
    }

    private async get(action: string, module: string, params?: Record<string, string>): Promise<Response> {
        const url = new URL(this.endpoint)
        url.search = makeQuerystring({ action, apiKey: this.apiKey, module, ...params })
        return await fetch(url, { agent: this.httpsAgent })
    }

    public async readHeight(): Promise<number> {
        const resp = await this.get('eth_blockNumber', 'proxy')
        const data = await resp.json() as ProxyResponse

        const result = data?.result
        if (typeof result !== 'string') {
            throw new Error(`Invalid server response: ${JSON.stringify(data ?? `${resp.status} ${resp.statusText}`)}`)
        }

        return hexToNumber(result)
    }

    /**
     * @param page page number of transactions
     * @param offset transactions per page
     * @param height latest block number to retrieve transactions
     * @param start starting block number
     * @param contract contract address of ERC-20 token
     */
    private async readTokenTxPage(page: number, offset: number, height: number, start: number, contract: string): Promise<Transaction[]> {
        const resp = await this.get('tokentx', 'account', {
            contractaddress: contract,
            endblock: height.toString(),
            page: page.toString(),
            offset: offset.toString(),
            sort: 'asc',
            startblock: start.toString()
        })

        if (resp.status !== 200) {
            throw new Error(`HTTP Error ${resp.status}: ${resp.statusText}`)
        }

        const data = await resp.json() as QueryResponse<Transaction[]>

        switch (data?.status) {
            // TODO: runtime check to verify data (e.g io-ts)
            case '0':
                throw new NoTransactionError(data?.message ?? 'No transactions found')
            case '1':
                if (!(data.result instanceof Array) || data.result.length === 0) {
                    throw new NoTransactionError(data?.message ?? 'No transactions returned')
                }
                return data.result
            default:
                throw new Error(data?.message ?? 'Unknown error')
        }
    }

    /**
     * @param height latest block number to retrieve transactions
     * @param start starting block number
     * @param contract contract address of ERC-20 token
     * @yields transactions splitted into pages
     */
    public async * readTokenTx(height: number, start: number, contract: string): AsyncGenerator<Transaction[], void, void> {
        let page = 1
        let retries = 0
        while (true) {
            try {
                const transactions = await this.readTokenTxPage(page, defaultPageSize, height, start, contract)
                yield transactions

                if (transactions.length < defaultPageSize) {
                    // no remaining transaction page
                    break
                }

                page++
                retries = 0
            } catch (error) {
                if (error instanceof NoTransactionError) {
                    // no remaining transaction page
                    break
                }

                if (retries > defaultRetries) {
                    // retry for other errors
                    throw error
                }

                console.error(`Retrying. Read page ${page} failed: ${(error as Error)?.message ?? error}`)
                retries++
            }
        }
    }
}
