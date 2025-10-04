const { ethers } = require("hardhat");

async function main() {
  console.log("Starting deployment of Prediction Market System...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH\n");

  console.log("Deploying SettlementToken...");
  const SettlementToken = await ethers.getContractFactory("SettlementToken");
  const settlementToken = await SettlementToken.deploy("Prediction Market Token", "PMT");
  await settlementToken.waitForDeployment();
  
  const settlementTokenAddress = await settlementToken.getAddress();
  console.log("SettlementToken deployed to:", settlementTokenAddress);
  console.log("   - Name:", await settlementToken.name());
  console.log("   - Symbol:", await settlementToken.symbol());
  console.log("   - Admin:", await settlementToken.hasRole(await settlementToken.DEFAULT_ADMIN_ROLE(), deployer.address) ? "Yes" : "No");
  console.log("   - Minter:", await settlementToken.hasRole(await settlementToken.MINTER_ROLE(), deployer.address) ? "Yes" : "No\n");

  console.log("Deploying MarketFactory...");
  const MarketFactory = await ethers.getContractFactory("MarketFactory");
  const marketFactory = await MarketFactory.deploy(settlementTokenAddress, deployer.address);
  await marketFactory.waitForDeployment();
  
  const marketFactoryAddress = await marketFactory.getAddress();
  console.log("MarketFactory deployed to:", marketFactoryAddress);
  console.log("   - Settlement Token:", settlementTokenAddress);
  console.log("   - Admin:", await marketFactory.hasRole(await marketFactory.DEFAULT_ADMIN_ROLE(), deployer.address) ? "Yes" : "No");
  console.log("   - Initial market count:", await marketFactory.numMarkets(), "\n");

  console.log("Minting initial tokens...");
  const mintAmount = ethers.parseEther("1000000");
  await settlementToken.mint(deployer.address, mintAmount);
  console.log("Minted", ethers.formatEther(mintAmount), "tokens to deployer\n");

  console.log("Creating sample market...");
  const sampleQuestion = ethers.id("Will Bitcoin reach $100,000 by end of 2024?");
  const resolveTimestamp = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
  const initYesPool = ethers.parseEther("10000");
  const initNoPool = ethers.parseEther("10000");
  const feeBps = 100;

  const tx = await marketFactory.createMarket(
    sampleQuestion,
    resolveTimestamp,
    initYesPool,
    initNoPool,
    feeBps,
    deployer.address
  );

  const receipt = await tx.wait();
  
  const marketDeployedEvent = receipt.logs.find(log => {
    try {
      const parsed = marketFactory.interface.parseLog({
        topics: log.topics,
        data: log.data
      });
      return parsed && parsed.name === 'MarketDeployed';
    } catch (e) {
      return false;
    }
  });
  
  const sampleMarketAddress = marketFactory.interface.parseLog({
    topics: marketDeployedEvent.topics,
    data: marketDeployedEvent.data
  }).args.marketAddress;

  console.log("Sample market created at:", sampleMarketAddress);
  
  const Market = await ethers.getContractFactory("Market");
  const sampleMarket = Market.attach(sampleMarketAddress);
  
  console.log("   - Question hash:", sampleQuestion);
  console.log("   - Resolve timestamp:", new Date(Number(resolveTimestamp) * 1000).toISOString());
  console.log("   - Initial YES pool:", ethers.formatEther(initYesPool));
  console.log("   - Initial NO pool:", ethers.formatEther(initNoPool));
  console.log("   - Fee:", feeBps / 100, "%\n");

  console.log("Funding sample market with initial liquidity...");
  const totalLiquidity = initYesPool + initNoPool;
  await settlementToken.transfer(sampleMarketAddress, totalLiquidity);
  console.log("Transferred", ethers.formatEther(totalLiquidity), "tokens to sample market\n");

  console.log("Setting up oracle permissions...");
  await sampleMarket.grantRole(await sampleMarket.ORACLE_ROLE(), deployer.address);
  console.log("Deployer granted ORACLE_ROLE for sample market\n");

  console.log("Deployment Summary:");
  console.log("=====================");
  console.log("SettlementToken:", settlementTokenAddress);
  console.log("MarketFactory:", marketFactoryAddress);
  console.log("Sample Market:", sampleMarketAddress);
  console.log("Deployer (Admin & Oracle):", deployer.address);
  console.log("\nNetwork:", network.name);
  console.log("Gas used:", receipt.gasUsed.toString());
  console.log("Final balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH");

  const deploymentInfo = {
    network: network.name,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      settlementToken: settlementTokenAddress,
      marketFactory: marketFactoryAddress,
      sampleMarket: sampleMarketAddress
    },
    sampleMarket: {
      question: sampleQuestion,
      resolveTimestamp: resolveTimestamp.toString(),
      initYesPool: initYesPool.toString(),
      initNoPool: initNoPool.toString(),
      feeBps: feeBps
    }
  };

  const fs = require('fs');
  const path = require('path');
  const deploymentPath = path.join(__dirname, '..', 'deployments', `${network.name}.json`);
  
  const deploymentsDir = path.dirname(deploymentPath);
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("\nDeployment info saved to:", deploymentPath);

  console.log("\nDeployment completed successfully!");
  console.log("\nNext steps:");
  console.log("1. Verify contracts on Etherscan");
  console.log("2. Test the deployed contracts");
  console.log("3. Create more markets as needed");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });