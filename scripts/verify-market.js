const { run } = require("hardhat");

async function main() {
  console.log("Verifying Market contract...\n");

  const network = await hre.network;
  console.log("Network:", network.name);

  const marketAddress = "0xa9b5FE7cd5877Ae86232bAa2f68AAc8a3e0a8257";
  
  const settlementTokenAddress = "0x40E301b4b0bE1CdBC6FCed08DA1700e46C7414B6";

  const constructorArgs = [
    settlementTokenAddress,
    "0xe0742a1c3c8e6b3db3f92b4029f4ea15c4fcf9df83461917d3dc0053fb45c84d",
    "1759580800",
    "100000000000000000000",
    "100000000000000000000",
    "100",
    "0x1df86eAcBbCb398BC5bac64C1391D66c7950fA65",
    "0x1df86eAcBbCb398BC5bac64C1391D66c7950fA65"
  ];

  console.log("Market Contract Details:");
  console.log("Address:", marketAddress);
  console.log("Constructor Arguments:");
  console.log("  - Settlement Token:", constructorArgs[0]);
  console.log("  - Question Hash:", constructorArgs[1]);
  console.log("  - Resolve Timestamp:", constructorArgs[2], "(" + new Date(parseInt(constructorArgs[2]) * 1000).toISOString() + ")");
  console.log("  - Initial YES Pool:", constructorArgs[3], "(" + (parseInt(constructorArgs[3]) / 1e18) + " ETH)");
  console.log("  - Initial NO Pool:", constructorArgs[4], "(" + (parseInt(constructorArgs[4]) / 1e18) + " ETH)");
  console.log("  - Fee (bps):", constructorArgs[5], "(" + (parseInt(constructorArgs[5]) / 100) + "%)");
  console.log("  - Fee Recipient:", constructorArgs[6]);
  console.log("  - Admin:", constructorArgs[7]);
  console.log("");

  try {
    console.log("Starting verification...");
    
    await run("verify:verify", {
      address: marketAddress,
      constructorArguments: constructorArgs,
    });
    
    console.log("Market contract verified successfully!");
    console.log("\nEtherscan Link:");
    const etherscanBase = network.name === 'mainnet' ? 'https://etherscan.io' : 'https://sepolia.etherscan.io';
    console.log(`${etherscanBase}/address/${marketAddress}`);

  } catch (error) {
    console.error("Verification failed:", error.message);
    
    if (error.message.includes("Already Verified")) {
      console.log("Contract is already verified on Etherscan");
      console.log("\nEtherscan Link:");
      const etherscanBase = network.name === 'mainnet' ? 'https://etherscan.io' : 'https://sepolia.etherscan.io';
      console.log(`${etherscanBase}/address/${marketAddress}`);
    } else if (error.message.includes("Rate limit")) {
      console.log("Rate limit exceeded. Please wait a moment and try again.");
    } else if (error.message.includes("constructor arguments")) {
      console.log("The constructor arguments might be incorrect.");
      console.log("Please verify the order and values match exactly with the deployment.");
    } else {
      console.log("Try running verification manually:");
      console.log(`npx hardhat verify --network ${network.name} ${marketAddress} ${constructorArgs.join(' ')}`);
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