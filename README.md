# erc20-burn-relay, the next generation

## installation

Clone this repository and set up dependencies with `yarn install --prod`.

## configuration

Create a `.env` file under the root directory (more specifically, next to `package.json`) with your configuration.

This relay relies on Etherscan (currently). You need to get your own API key at [Etherscan](https://etherscan.io/myapikey).

```sh
ALICE=//Alice
ETHERSCAN_API_KEY=your_etherscan_api_key_here
NETWORK=main
```

You may also want to specify some additional stuff to support your needs.

```sh
DEBUG=yes
HTTP_PROXY=http://localhost:8000
```

## start

You're now ready to go. Run `yarn start` to start the relay.

## roadmap (to-do)

- [X] Data Source: [Etherscan](https://etherscan.io/)
- [ ] Data Source: [ArchiveNode.io](https://archivenode.io/)
- [ ] Data Source: [Infura](https://infura.io/)
- [ ] Live monitoring (instead of periodically fetching)
- [ ] Validation across multiple data sources
