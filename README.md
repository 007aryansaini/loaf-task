# Prediction Market System

A decentralized prediction market system built on Ethereum using Solidity and Hardhat. This system allows users to create, participate in, and resolve binary prediction markets with automated market making (AMM) functionality.

## Overview

The prediction market system consists of three main contracts:

1. **SettlementToken** - ERC20 token used for all market transactions
2. **MarketFactory** - Factory contract for creating new prediction markets
3. **Market** - Individual prediction market contracts with CPMM (Constant Product Market Maker) functionality

## Contracts

### SettlementToken

An ERC20 token with minting capabilities and access control.

#### Functions

- `constructor(string name, string symbol)` - Deploy token with name and symbol
- `mint(address to, uint256 amount)` - Mint tokens to specified address (MINTER_ROLE required)
- `faucet(address to, uint256 amount)` - Mint tokens for testing (MINTER_ROLE required)

#### Roles

- `DEFAULT_ADMIN_ROLE` - Can grant/revoke roles and manage the contract
- `MINTER_ROLE` - Can mint new tokens

### MarketFactory

Factory contract for deploying new prediction markets.

#### Functions

- `constructor(IERC20 settlementToken, address admin)` - Deploy factory with settlement token and admin
- `createMarket(bytes32 question, uint32 resolveTimestamp, uint256 initYesPool, uint256 initNoPool, uint16 feeBps, address feeRecipient)` - Create new prediction market
- `numMarkets()` - Get total number of markets created
- `getMarkets()` - Get array of all market addresses

#### Events

- `MarketDeployed(address indexed marketAddress, address indexed creator, bytes32 question)` - Emitted when new market is created

### Market

Individual prediction market contract implementing CPMM for binary outcomes (YES/NO).

#### States

- `Created` (0) - Market created but not yet active
- `Active` (1) - Market is open for trading
- `Resolved` (2) - Market has been resolved with outcome
- `Cancelled` (3) - Market was cancelled, refunds available

#### Functions

##### Trading Functions

- `buyYes(uint256 amount)` - Buy YES position by depositing settlement tokens
- `buyNo(uint256 amount)` - Buy NO position by depositing settlement tokens

##### Resolution Functions

- `resolve(uint8 outcome)` - Resolve market (ORACLE_ROLE required)
  - `0` = NO wins
  - `1` = YES wins  
  - `2` = Cancel market

##### Claiming Functions

- `claim()` - Claim winnings after market resolution
- `refund()` - Refund positions if market was cancelled

##### Admin Functions

- `setFeeBps(uint16 newFee)` - Update market fee (DEFAULT_ADMIN_ROLE required)
- `setFeeRecipient(address newRecipient)` - Update fee recipient (DEFAULT_ADMIN_ROLE required)
- `rescueERC20(IERC20 token, address to, uint256 amount)` - Rescue non-settlement tokens (DEFAULT_ADMIN_ROLE required)

##### View Functions

- `currentPriceYes()` - Get current YES price (numerator, denominator)
- `currentPriceNo()` - Get current NO price (numerator, denominator)
- `yesPositions(address user)` - Get user's YES position
- `noPositions(address user)` - Get user's NO position

#### Events

- `MarketCreated(address indexed creator, bytes32 question, uint32 resolveTimestamp, uint256 yesPool, uint256 noPool, uint16 feeBps)`
- `BetPlaced(address indexed user, bool indexed outcome, uint256 amountIn, uint256 positionUnits)`
- `MarketResolved(uint8 indexed outcome, address indexed resolver)`
- `Claimed(address indexed user, address indexed to, uint256 amount)`
- `MarketCancelled(address indexed canceller)`
- `FeeCollected(address indexed feeRecipient, uint256 amount)`

#### Roles

- `DEFAULT_ADMIN_ROLE` - Can update fees, fee recipient, rescue tokens
- `ORACLE_ROLE` - Can resolve markets

## CPMM (Constant Product Market Maker)

The market uses a constant product formula: `k = yesPool * noPool`

When buying YES:
- User adds tokens to NO pool
- Receives YES position units based on CPMM calculation
- Price moves against the buyer (slippage)

When buying NO:
- User adds tokens to YES pool  
- Receives NO position units based on CPMM calculation
- Price moves against the buyer (slippage)

## Setup

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Git

### Installation

```bash
git clone https://github.com/007aryansaini/loaf-task.git
cd contracts
npm install
```

### Environment Setup

Create a `.env` file in the contracts directory:

```env
PRIVATE_KEY=your_private_key_here
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID
ETHERSCAN_API_KEY=your_etherscan_api_key_here
```

## Testing

### Run All Tests

```bash
npx hardhat test
```

### Run Tests with Gas Reporting

```bash
REPORT_GAS=true npx hardhat test
```

### Run Specific Test Suites

```bash
# Test SettlementToken only
npx hardhat test --grep "SettlementToken"

# Test MarketFactory only  
npx hardhat test --grep "MarketFactory"

# Test Market only
npx hardhat test --grep "Market"
```

### Test Coverage

The test suite includes comprehensive coverage:

- **SettlementToken**: 7 tests covering deployment, minting, and access control
- **MarketFactory**: 5 tests covering deployment and market creation
- **Market**: 33 tests covering deployment, CPMM math, trading, resolution, claiming, refunds, admin functions, and edge cases

## Deployment

### Local Development

```bash
# Start local Hardhat node
npx hardhat node

# Deploy to local network (in another terminal)
npx hardhat run scripts/deploy.js --network localhost
```

### Testnet Deployment (Sepolia)

```bash
# Deploy to Sepolia
npx hardhat run scripts/deploy.js --network sepolia

# Verify contracts
npx hardhat run scripts/verify.js --network sepolia
```

### Mainnet Deployment

```bash
# Deploy to mainnet
npx hardhat run scripts/deploy.js --network mainnet

# Verify contracts
npx hardhat run scripts/verify.js --network mainnet
```

## Contract Verification

### Automatic Verification

The deployment script automatically saves deployment information. Use the verification script:

```bash
npx hardhat run scripts/verify.js --network sepolia
```

### Manual Verification

If automatic verification fails, verify contracts individually:

```bash
# Verify SettlementToken
npx hardhat verify --network sepolia <SETTLEMENT_TOKEN_ADDRESS> "Prediction Market Token" "PMT"

# Verify MarketFactory
npx hardhat verify --network sepolia <MARKET_FACTORY_ADDRESS> <SETTLEMENT_TOKEN_ADDRESS> <DEPLOYER_ADDRESS>

# Verify specific Market
npx hardhat verify --network sepolia <MARKET_ADDRESS> <SETTLEMENT_TOKEN_ADDRESS> <QUESTION_HASH> <RESOLVE_TIMESTAMP> <INIT_YES_POOL> <INIT_NO_POOL> <FEE_BPS> <FEE_RECIPIENT> <ADMIN>
```

### Verify Individual Market Contract

For verifying a specific market contract:

```bash
npx hardhat run scripts/verify-market.js --network sepolia
```

## Usage Examples

### Creating a New Market

```javascript
const marketFactory = await ethers.getContractAt("MarketFactory", marketFactoryAddress);

const question = ethers.id("Will ETH reach $3000 by end of 2024?");
const resolveTimestamp = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days
const initYesPool = ethers.parseEther("1000");
const initNoPool = ethers.parseEther("1000");
const feeBps = 100; // 1%

await marketFactory.createMarket(
  question,
  resolveTimestamp,
  initYesPool,
  initNoPool,
  feeBps,
  feeRecipientAddress
);
```

### Trading in a Market

```javascript
const market = await ethers.getContractAt("Market", marketAddress);

// Buy YES position
await market.buyYes(ethers.parseEther("100"));

// Buy NO position  
await market.buyNo(ethers.parseEther("50"));
```

### Resolving a Market

```javascript
const market = await ethers.getContractAt("Market", marketAddress);

// Resolve as YES (1), NO (0), or Cancel (2)
await market.resolve(1); // YES wins
```

### Claiming Winnings

```javascript
const market = await ethers.getContractAt("Market", marketAddress);

// Claim winnings after resolution
await market.claim();

// Refund positions if market was cancelled
await market.refund();
```

## Gas Optimization

The contracts are optimized for gas efficiency:

- Uses OpenZeppelin's optimized contracts
- Implements efficient CPMM calculations
- Minimal storage operations
- ReentrancyGuard for security

## Security Features

- **Access Control**: Role-based permissions using OpenZeppelin AccessControl
- **ReentrancyGuard**: Protection against reentrancy attacks
- **Input Validation**: Comprehensive parameter validation
- **Safe Math**: Built-in overflow protection
- **Emergency Functions**: Admin can rescue non-settlement tokens

## Network Support

- **Local**: Hardhat local network
- **Testnet**: Ethereum Sepolia
- **Mainnet**: Ethereum Mainnet

## Troubleshooting

### Common Issues

1. **Insufficient Funds**: Ensure you have enough ETH for gas fees
2. **Invalid Parameters**: Check constructor arguments match deployment
3. **Already Verified**: Contracts already verified on Etherscan
4. **Rate Limit**: Wait before retrying verification

### Getting Help

- Check deployment logs for specific error messages
- Verify environment variables are correct
- Ensure sufficient ETH for gas fees
- Check that RPC endpoints are working

## License

This project is licensed under the MIT License.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## Support

For questions or issues, please open an issue on the repository.