const { run } = require("hardhat");

async function main() {
  console.log("Starting contract verification...\n");

  const network = await hre.network;
  console.log("Network:", network.name);

  const fs = require('fs');
  const path = require('path');
  const deploymentPath = path.join(__dirname, '..', 'deployments', `${network.name}.json`);
  
  if (!fs.existsSync(deploymentPath)) {
    console.error("No deployment info found for network:", network.name);
    console.log("Please run deployment first: npx hardhat run scripts/deploy.js --network", network.name);
    process.exit(1);
  }

  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  console.log("Deployment timestamp:", deploymentInfo.timestamp);
  console.log("Deployer:", deploymentInfo.deployer, "\n");

  try {
    console.log("Verifying SettlementToken...");
    await run("verify:verify", {
      address: deploymentInfo.contracts.settlementToken,
      constructorArguments: ["Prediction Market Token", "PMT"],
    });
    console.log("SettlementToken verified successfully\n");

    console.log("Verifying MarketFactory...");
    await run("verify:verify", {
      address: deploymentInfo.contracts.marketFactory,
      constructorArguments: [deploymentInfo.contracts.settlementToken, deploymentInfo.deployer],
    });
    console.log("MarketFactory verified successfully\n");

    console.log("Verifying Sample Market...");
    await run("verify:verify", {
      address: deploymentInfo.contracts.sampleMarket,
      constructorArguments: [
        deploymentInfo.contracts.settlementToken,
        deploymentInfo.sampleMarket.question,
        deploymentInfo.sampleMarket.resolveTimestamp,
        deploymentInfo.sampleMarket.initYesPool,
        deploymentInfo.sampleMarket.initNoPool,
        deploymentInfo.sampleMarket.feeBps,
        deploymentInfo.deployer,
        deploymentInfo.deployer
      ],
    });
    console.log("Sample Market verified successfully\n");

    console.log("All contracts verified successfully!");
    console.log("\nVerification Summary:");
    console.log("========================");
    console.log("SettlementToken:", deploymentInfo.contracts.settlementToken);
    console.log("MarketFactory:", deploymentInfo.contracts.marketFactory);
    console.log("Sample Market:", deploymentInfo.contracts.sampleMarket);
    
    console.log("\nEtherscan Links:");
    const etherscanBase = network.name === 'mainnet' ? 'https://etherscan.io' : 'https://sepolia.etherscan.io';
    console.log(`SettlementToken: ${etherscanBase}/address/${deploymentInfo.contracts.settlementToken}`);
    console.log(`MarketFactory: ${etherscanBase}/address/${deploymentInfo.contracts.marketFactory}`);
    console.log(`Sample Market: ${etherscanBase}/address/${deploymentInfo.contracts.sampleMarket}`);

  } catch (error) {
    console.error("Verification failed:", error.message);
    
    if (error.message.includes("Already Verified")) {
      console.log("Contracts are already verified on Etherscan");
    } else if (error.message.includes("Rate limit")) {
      console.log("Rate limit exceeded. Please wait a moment and try again.");
    } else {
      console.log("Try running verification individually for each contract:");
      console.log(`npx hardhat verify --network ${network.name} <contract_address> <constructor_args>`);
    }
    
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Verification script failed:", error);
    process.exit(1);
  });