import { hexToNumber } from '@polkadot/util'
import { AssertionError } from 'assert'
import { isRight } from 'fp-ts/lib/These'
import createHttpsProxyAgent from 'https-proxy-agent'
import HttpsProxyAgent from 'https-proxy-agent/dist/agent'
import { PathReporter } from 'io-ts/PathReporter'
import { getLogger } from 'loglevel'
import fetch, { Response } from 'node-fetch'
import { stringify as makeQuerystring } from 'querystring'
import { URL } from 'url'
import { TokenTransaction, tokenTransactionQueryResponse } from './io'

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

/**
 * Maximum retry of a request
 */
const maximumRetries = 5

/**
 * Approximate maximum amount of transactions per block
 */
const defaultPageSize = 1000

export class NoTransactionError extends Error { }

/**
 * Reading window (transactions per page) is too small to contain all transactions in a block
 */
export class ReadWindowToSmallError extends Error { }

export class TooManyRetriesError extends Error {
    public readonly innerErrors: Error[]

    constructor(innerErrors: Error[]) {
        super('Too many retries')
        this.innerErrors = innerErrors
    }
}

export class EtherscanClient {
    private readonly apiKey: string

    private readonly endpoint: string

    private readonly httpsAgent?: HttpsProxyAgent

    private readonly log = getLogger('EtherscanClient')

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

    public static async withRetry<T>(request: () => Promise<T>, test?: (error: Error) => boolean): Promise<T> {
        const errors: Error[] = []

        for (let retry = 0; retry < maximumRetries; retry++) {
            try {
                return await request()
            } catch (error) {
                if (typeof test === 'function' && test(error)) {
                    // don't retry with specific errors
                    throw error
                }

                errors.push(error)
            }
        }

        throw new TooManyRetriesError(errors)
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
    public async readTokenTxPage(page: number, offset: number, height: number, start: number, contract: string): Promise<TokenTransaction[]> {
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

        const data = await resp.json() as QueryResponse<TokenTransaction[]>
        const decode = tokenTransactionQueryResponse.decode(data)

        /**
         *
         * NOTE: Etherscan has some weird behaviours on their result.
         *
         * Generally, succeeded request with transactions should have `data.status === 1`.
         *
         * Response with no transaction belongs to the contract will have `data.status === 0`.
         * And `data.result` will be `[]` (an empty array).
         *
         * However, error "result window too large" will have `data.status === 0` but return `null` for `data.result`.
         *
         */

        if (isRight(decode)) {
            return decode.right.result
        }

        if (data.status === '0' && data.result instanceof Array && data.result.length === 0) {
            throw new NoTransactionError(data?.message ?? 'No transactions returned')
        }

        this.log.debug(`Decode failed: ${PathReporter.report(decode).join('\n')}`)

        throw new Error(`API error: ${data?.message ?? 'Unknown error'}`)
    }

    /**
     * @param height latest block number to retrieve transactions
     * @param start starting block number
     * @param contract contract address of ERC-20 token
     * @yields transactions splitted into pages
     */
    public async * readTokenTx(height: number, start: number, contract: string): AsyncGenerator<TokenTransaction[], number, void> {
        const blocks = new Map<number, TokenTransaction[]>()
        let lastYieldBlock = 0
        let nextPage = 1

        while (true) {
            if (blocks.size <= 1) {
                if (nextPage * defaultPageSize >= 10000) {
                    this.log.debug(`Generator stopped at page ${nextPage}, offset ${defaultPageSize}, height ${lastYieldBlock}, backlog ${blocks.size} blocks`)
                    return lastYieldBlock
                }

                let page: TokenTransaction[]
                try {
                    page = await EtherscanClient.withRetry(async () => {
                        this.log.debug(`readTokenTxPage(${nextPage}, ${defaultPageSize}, ${height}, ${start}, ${contract})`)
                        return await this.readTokenTxPage(nextPage, defaultPageSize, height, start, contract)
                    }, (error) => error instanceof NoTransactionError)
                } catch (error) {
                    if (error instanceof NoTransactionError) {
                        return lastYieldBlock
                    }

                    throw error
                }

                page.forEach(tx => {
                    const blockNumber = parseInt(tx.blockNumber)
                    if (blocks.has(blockNumber)) {
                        blocks.get(blockNumber)?.push(tx)
                    } else {
                        blocks.set(blockNumber, new Array(tx))
                    }
                })

                nextPage++

                this.log.debug(`Transaction backlog has ${blocks.size} blocks after read`)
            } else {
                const blockNumber = Array.from(blocks.keys()).sort((a, b) => a - b)[0]
                if (blockNumber === undefined) { throw new AssertionError() }

                const block = blocks.get(blockNumber)
                if (block === undefined) { throw new AssertionError() }
                blocks.delete(blockNumber)

                lastYieldBlock = blockNumber
                yield block
            }
        }
    }
}
