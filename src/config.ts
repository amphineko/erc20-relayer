export interface AgentConfiguration {
    alice: string

    etherscanApiKey: string

    proxy?: string
}

export interface NetworkDescription {
    /**
     * ERC-20 contract address
     */
    contract: string

    /**
     * The block number of the ERC-20 contract
     */
    contractHeight: number

    /**
     * WebSocket endpoint of Phala network
     */
    endpoint: string

    /**
     * Etherscan API endpoint to retrieve burning transactions
     */
    etherscanApiBase: string
}

export const networks: Record<string, NetworkDescription> = {
    main: {
        contract: '0x6c5ba91642f10282b576d91922ae6448c9d52f4e',
        endpoint: 'wss://poc4.phala.network/ws',
        etherscanApiBase: 'https://api.etherscan.io/api'
    },
    kovan: {
        contract: '0x512f7a3c14b6ee86c2015bc8ac1fe97e657f75f2',
        contractHeight: 20775211,
        endpoint: 'wss://poc4.phala.network/ws',
        etherscanApiBase: 'https://api-kovan.etherscan.io/api'
    }
}
