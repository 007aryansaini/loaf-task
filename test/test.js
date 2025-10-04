const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");

describe("Prediction Market System", function () {
  async function deployContractsFixture() {
    const [admin, oracle, user1, user2, user3, feeRecipient] = await ethers.getSigners();

    const SettlementToken = await ethers.getContractFactory("SettlementToken");
    const settlementToken = await SettlementToken.deploy("Test Token", "TEST");

    const MarketFactory = await ethers.getContractFactory("MarketFactory");
    const marketFactory = await MarketFactory.deploy(settlementToken.target, admin.address);

    await marketFactory.connect(admin).grantRole(
      await marketFactory.ORACLE_ROLE(), 
      oracle.address
    );

    return {
      admin,
      oracle,
      user1,
      user2,
      user3,
      feeRecipient,
      settlementToken,
      marketFactory
    };
  }

  async function createMarketFixture() {
    const contracts = await loadFixture(deployContractsFixture);
    const { admin, settlementToken, marketFactory } = contracts;

    await settlementToken.mint(admin.address, ethers.parseEther("10000"));

    const question = ethers.id("Will Bitcoin reach $100k by 2024?");
    const resolveTimestamp = Math.floor(Date.now() / 1000) + 86400;
    const initYesPool = ethers.parseEther("1000");
    const initNoPool = ethers.parseEther("1000");
    const feeBps = 100;

    const tx = await marketFactory.connect(admin).createMarket(
      question,
      resolveTimestamp,
      initYesPool,
      initNoPool,
      feeBps,
      contracts.feeRecipient.address
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
    
    const marketAddress = marketFactory.interface.parseLog({
      topics: marketDeployedEvent.topics,
      data: marketDeployedEvent.data
    }).args.marketAddress;

    const Market = await ethers.getContractFactory("Market");
    const market = Market.attach(marketAddress);

    await settlementToken.connect(admin).transfer(marketAddress, initYesPool + initNoPool);

    await market.connect(admin).grantRole(await market.ORACLE_ROLE(), contracts.oracle.address);

    return {
      ...contracts,
      market,
      question,
      resolveTimestamp,
      initYesPool,
      initNoPool,
      feeBps
    };
  }

  async function mintTokensFixture() {
    const contracts = await loadFixture(createMarketFixture);
    const { settlementToken, user1, user2, user3 } = contracts;

    await settlementToken.mint(user1.address, ethers.parseEther("5000"));
    await settlementToken.mint(user2.address, ethers.parseEther("5000"));
    await settlementToken.mint(user3.address, ethers.parseEther("5000"));

    await settlementToken.connect(user1).approve(contracts.market.target, ethers.parseEther("5000"));
    await settlementToken.connect(user2).approve(contracts.market.target, ethers.parseEther("5000"));
    await settlementToken.connect(user3).approve(contracts.market.target, ethers.parseEther("5000"));

    return contracts;
  }

  describe("SettlementToken", function () {
    describe("Deployment", function () {
      it("Should set the right name and symbol", async function () {
        const { settlementToken } = await loadFixture(deployContractsFixture);
        
        expect(await settlementToken.name()).to.equal("Test Token");
        expect(await settlementToken.symbol()).to.equal("TEST");
      });

      it("Should set the right admin role", async function () {
        const { settlementToken, admin } = await loadFixture(deployContractsFixture);
        
        expect(await settlementToken.hasRole(await settlementToken.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
      });

      it("Should set the right minter role", async function () {
        const { settlementToken, admin } = await loadFixture(deployContractsFixture);
        
        expect(await settlementToken.hasRole(await settlementToken.MINTER_ROLE(), admin.address)).to.be.true;
      });
    });

    describe("Minting", function () {
      it("Should allow admin to mint tokens", async function () {
        const { settlementToken, admin, user1 } = await loadFixture(deployContractsFixture);
        
        await expect(settlementToken.connect(admin).mint(user1.address, ethers.parseEther("1000")))
          .to.emit(settlementToken, "Transfer")
          .withArgs(ethers.ZeroAddress, user1.address, ethers.parseEther("1000"));
        
        expect(await settlementToken.balanceOf(user1.address)).to.equal(ethers.parseEther("1000"));
      });

      it("Should allow minter to mint tokens", async function () {
        const { settlementToken, admin, user1, user2 } = await loadFixture(deployContractsFixture);
        
        await settlementToken.connect(admin).grantRole(await settlementToken.MINTER_ROLE(), user2.address);
        
        await expect(settlementToken.connect(user2).mint(user1.address, ethers.parseEther("500")))
          .to.emit(settlementToken, "Transfer")
          .withArgs(ethers.ZeroAddress, user1.address, ethers.parseEther("500"));
      });

      it("Should reject minting from non-minter", async function () {
        const { settlementToken, user1, user2 } = await loadFixture(deployContractsFixture);
        
        await expect(settlementToken.connect(user1).mint(user2.address, ethers.parseEther("100")))
          .to.be.revertedWithCustomError(settlementToken, "AccessControlUnauthorizedAccount");
      });

      it("Should allow admin to use faucet function", async function () {
        const { settlementToken, admin, user1 } = await loadFixture(deployContractsFixture);
        
        await expect(settlementToken.connect(admin).faucet(user1.address, ethers.parseEther("100")))
          .to.emit(settlementToken, "Transfer")
          .withArgs(ethers.ZeroAddress, user1.address, ethers.parseEther("100"));
      });
    });
  });

  describe("MarketFactory", function () {
    describe("Deployment", function () {
      it("Should set the right settlement token", async function () {
        const { marketFactory, settlementToken } = await loadFixture(deployContractsFixture);
        
        expect(await marketFactory.settlementToken()).to.equal(settlementToken.target);
      });

      it("Should set the right admin role", async function () {
        const { marketFactory, admin } = await loadFixture(deployContractsFixture);
        
        expect(await marketFactory.hasRole(await marketFactory.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
      });

      it("Should start with zero markets", async function () {
        const { marketFactory } = await loadFixture(deployContractsFixture);
        
        expect(await marketFactory.numMarkets()).to.equal(0);
      });
    });

    describe("Market Creation", function () {
      it("Should create a market successfully", async function () {
        const { marketFactory, admin, settlementToken } = await loadFixture(deployContractsFixture);
        
        const question = ethers.id("Test question");
        const resolveTimestamp = Math.floor(Date.now() / 1000) + 86400;
        const initYesPool = ethers.parseEther("100");
        const initNoPool = ethers.parseEther("100");
        const feeBps = 100;

        await expect(marketFactory.connect(admin).createMarket(
          question,
          resolveTimestamp,
          initYesPool,
          initNoPool,
          feeBps,
          admin.address
        )).to.emit(marketFactory, "MarketDeployed");

        expect(await marketFactory.numMarkets()).to.equal(1);
      });

      it("Should track markets correctly", async function () {
        const { marketFactory, admin } = await loadFixture(deployContractsFixture);
        
        const question1 = ethers.id("Question 1");
        const question2 = ethers.id("Question 2");
        
        await marketFactory.connect(admin).createMarket(question1, 0, 100, 100, 0, ethers.ZeroAddress);
        await marketFactory.connect(admin).createMarket(question2, 0, 200, 200, 0, ethers.ZeroAddress);

        expect(await marketFactory.numMarkets()).to.equal(2);
        
        const markets = await marketFactory.getMarkets();
        expect(markets.length).to.equal(2);
        expect(markets[0]).to.not.equal(markets[1]);
      });
    });
  });

  describe("Market", function () {
    describe("Deployment", function () {
      it("Should set the right initial parameters", async function () {
        const { market, question, resolveTimestamp, initYesPool, initNoPool, feeBps, admin, marketFactory } = await loadFixture(createMarketFixture);
        
        expect(await market.question()).to.equal(question);
        expect(await market.resolveTimestamp()).to.equal(resolveTimestamp);
        expect(await market.yesPool()).to.equal(initYesPool);
        expect(await market.noPool()).to.equal(initNoPool);
        expect(await market.feeBps()).to.equal(feeBps);
        expect(await market.creator()).to.equal(marketFactory.target);
        expect(await market.state()).to.equal(1);
      });

      it("Should set the right admin role", async function () {
        const { market, admin } = await loadFixture(createMarketFixture);
        
        expect(await market.hasRole(await market.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
      });

      it("Should reject invalid parameters", async function () {
        const { admin, settlementToken, marketFactory } = await loadFixture(deployContractsFixture);
        
        await expect(marketFactory.connect(admin).createMarket(
          ethers.id("Test"),
          0,
          100,
          100,
          1001,
          admin.address
        )).to.be.revertedWith("fee too high");
      });
    });

    describe("CPMM Math", function () {
      it("Should calculate correct output for buyYes", async function () {
        const { market } = await loadFixture(createMarketFixture);
        
        const [numerator, denominator] = await market.currentPriceYes();
        expect(numerator).to.equal(ethers.parseEther("1000"));
        expect(denominator).to.equal(ethers.parseEther("1000"));
      });

      it("Should calculate correct output for buyNo", async function () {
        const { market } = await loadFixture(createMarketFixture);
        
        const [numerator, denominator] = await market.currentPriceNo();
        expect(numerator).to.equal(ethers.parseEther("1000"));
        expect(denominator).to.equal(ethers.parseEther("1000"));
      });
    });

    describe("Trading", function () {
      it("Should allow buying YES positions", async function () {
        const { market, settlementToken, user1, feeRecipient } = await loadFixture(mintTokensFixture);
        
        const amountIn = ethers.parseEther("100");
        const feeAmount = ethers.parseEther("1");
        
        await expect(market.connect(user1).buyYes(amountIn))
          .to.emit(market, "BetPlaced")
          .withArgs(user1.address, true, amountIn, anyValue)
          .and.to.emit(market, "FeeCollected")
          .withArgs(feeRecipient.address, feeAmount);

        expect(await market.yesPositions(user1.address)).to.be.gt(0);
        expect(await market.totalYesPositions()).to.be.gt(0);
        expect(await market.noPool()).to.be.gt(ethers.parseEther("1000"));
        expect(await market.yesPool()).to.be.lt(ethers.parseEther("1000"));
      });

      it("Should allow buying NO positions", async function () {
        const { market, settlementToken, user1 } = await loadFixture(mintTokensFixture);
        
        const amountIn = ethers.parseEther("100");
        
        await expect(market.connect(user1).buyNo(amountIn))
          .to.emit(market, "BetPlaced")
          .withArgs(user1.address, false, amountIn, anyValue);

        expect(await market.noPositions(user1.address)).to.be.gt(0);
        expect(await market.totalNoPositions()).to.be.gt(0);
        expect(await market.yesPool()).to.be.gt(ethers.parseEther("1000"));
        expect(await market.noPool()).to.be.lt(ethers.parseEther("1000"));
      });

      it("Should reject zero amount trades", async function () {
        const { market, user1 } = await loadFixture(mintTokensFixture);
        
        await expect(market.connect(user1).buyYes(0))
          .to.be.revertedWith("amount>0");
        
        await expect(market.connect(user1).buyNo(0))
          .to.be.revertedWith("amount>0");
      });

      it("Should handle trades without fees", async function () {
        const { admin, settlementToken, marketFactory, user1 } = await loadFixture(deployContractsFixture);
        
        await settlementToken.mint(admin.address, ethers.parseEther("10000"));
        
        const question = ethers.id("No fee market");
        const tx = await marketFactory.connect(admin).createMarket(
          question, 0, ethers.parseEther("1000"), ethers.parseEther("1000"), 0, ethers.ZeroAddress
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
        
        const marketAddress = marketFactory.interface.parseLog({
          topics: marketDeployedEvent.topics,
          data: marketDeployedEvent.data
        }).args.marketAddress;
        
        const Market = await ethers.getContractFactory("Market");
        const market = Market.attach(marketAddress);
        
        await settlementToken.mint(user1.address, ethers.parseEther("1000"));
        await settlementToken.connect(user1).approve(marketAddress, ethers.parseEther("1000"));
        
        await settlementToken.connect(admin).transfer(marketAddress, ethers.parseEther("2000"));

        await expect(market.connect(user1).buyYes(ethers.parseEther("100")))
          .to.emit(market, "BetPlaced")
          .and.to.not.emit(market, "FeeCollected");
      });

      it("Should reject trades when market is not active", async function () {
        const { market, user1, oracle } = await loadFixture(mintTokensFixture);
        
        await market.connect(oracle).resolve(1);
        
        await expect(market.connect(user1).buyYes(ethers.parseEther("100")))
          .to.be.revertedWith("Invalid state for action");
      });
    });

    describe("Resolution", function () {
      it("Should allow oracle to resolve market as YES", async function () {
        const { market, oracle } = await loadFixture(mintTokensFixture);
        
        await expect(market.connect(oracle).resolve(1))
          .to.emit(market, "MarketResolved")
          .withArgs(1, oracle.address);

        expect(await market.state()).to.equal(2);
        expect(await market.resolutionOutcome()).to.equal(1);
      });

      it("Should allow oracle to resolve market as NO", async function () {
        const { market, oracle } = await loadFixture(mintTokensFixture);
        
        await expect(market.connect(oracle).resolve(0))
          .to.emit(market, "MarketResolved")
          .withArgs(0, oracle.address);

        expect(await market.state()).to.equal(2);
        expect(await market.resolutionOutcome()).to.equal(0);
      });

      it("Should allow oracle to cancel market", async function () {
        const { market, oracle } = await loadFixture(mintTokensFixture);
        
        await expect(market.connect(oracle).resolve(2))
          .to.emit(market, "MarketCancelled")
          .withArgs(oracle.address);

        expect(await market.state()).to.equal(3);
      });

      it("Should reject resolution from non-oracle", async function () {
        const { market, user1 } = await loadFixture(mintTokensFixture);
        
        await expect(market.connect(user1).resolve(1))
          .to.be.revertedWithCustomError(market, "AccessControlUnauthorizedAccount");
      });

      it("Should reject invalid outcome", async function () {
        const { market, oracle } = await loadFixture(mintTokensFixture);
        
        await expect(market.connect(oracle).resolve(3))
          .to.be.revertedWith("invalid outcome");
      });

      it("Should reject resolution when not active", async function () {
        const { market, oracle } = await loadFixture(mintTokensFixture);
        
        await market.connect(oracle).resolve(1);
        
        await expect(market.connect(oracle).resolve(0))
          .to.be.revertedWith("Invalid state for action");
      });
    });

    describe("Claiming", function () {
      it("Should allow YES winners to claim", async function () {
        const { market, settlementToken, user1, oracle } = await loadFixture(mintTokensFixture);
        
        await market.connect(user1).buyYes(ethers.parseEther("100"));
        const userYesPosition = await market.yesPositions(user1.address);
        
        await market.connect(oracle).resolve(1);
        
        const balanceBefore = await settlementToken.balanceOf(user1.address);
        await expect(market.connect(user1).claim())
          .to.emit(market, "Claimed")
          .withArgs(user1.address, user1.address, anyValue);
        
        const balanceAfter = await settlementToken.balanceOf(user1.address);
        expect(balanceAfter).to.be.gt(balanceBefore);
        expect(await market.yesPositions(user1.address)).to.equal(0);
      });

      it("Should allow NO winners to claim", async function () {
        const { market, settlementToken, user1, oracle } = await loadFixture(mintTokensFixture);
        
        await market.connect(user1).buyNo(ethers.parseEther("100"));
        const userNoPosition = await market.noPositions(user1.address);
        
        await market.connect(oracle).resolve(0);
        
        const balanceBefore = await settlementToken.balanceOf(user1.address);
        await expect(market.connect(user1).claim())
          .to.emit(market, "Claimed")
          .withArgs(user1.address, user1.address, anyValue);
        
        const balanceAfter = await settlementToken.balanceOf(user1.address);
        expect(balanceAfter).to.be.gt(balanceBefore);
        expect(await market.noPositions(user1.address)).to.equal(0);
      });

      it("Should reject claiming without position", async function () {
        const { market, user1, oracle } = await loadFixture(mintTokensFixture);
        
        await market.connect(oracle).resolve(1);
        
        await expect(market.connect(user1).claim())
          .to.be.revertedWith("no yes position");
      });

      it("Should reject claiming when not resolved", async function () {
        const { market, user1 } = await loadFixture(mintTokensFixture);
        
        await market.connect(user1).buyYes(ethers.parseEther("100"));
        
        await expect(market.connect(user1).claim())
          .to.be.revertedWith("Invalid state for action");
      });
    });

    describe("Refunds", function () {
      it("Should allow refunds when market is cancelled", async function () {
        const { market, settlementToken, user1, oracle } = await loadFixture(mintTokensFixture);
        
        await market.connect(user1).buyYes(ethers.parseEther("100"));
        await market.connect(user1).buyNo(ethers.parseEther("50"));
        
        const yesPosition = await market.yesPositions(user1.address);
        const noPosition = await market.noPositions(user1.address);
        
        await market.connect(oracle).resolve(2);
        
        const balanceBefore = await settlementToken.balanceOf(user1.address);
        await expect(market.connect(user1).refund())
          .to.emit(market, "Claimed")
          .withArgs(user1.address, user1.address, yesPosition)
          .and.to.emit(market, "Claimed")
          .withArgs(user1.address, user1.address, noPosition);
        
        const balanceAfter = await settlementToken.balanceOf(user1.address);
        expect(balanceAfter - balanceBefore).to.equal(yesPosition + noPosition);
        expect(await market.yesPositions(user1.address)).to.equal(0);
        expect(await market.noPositions(user1.address)).to.equal(0);
      });

      it("Should reject refunds without positions", async function () {
        const { market, user1, oracle } = await loadFixture(mintTokensFixture);
        
        await market.connect(oracle).resolve(2);
        
        await expect(market.connect(user1).refund())
          .to.be.revertedWith("no positions");
      });

      it("Should reject refunds when not cancelled", async function () {
        const { market, user1 } = await loadFixture(mintTokensFixture);
        
        await market.connect(user1).buyYes(ethers.parseEther("100"));
        
        await expect(market.connect(user1).refund())
          .to.be.revertedWith("Invalid state for action");
      });
    });

    describe("Admin Functions", function () {
      it("Should allow admin to set fee", async function () {
        const { market, admin } = await loadFixture(createMarketFixture);
        
        await market.connect(admin).setFeeBps(200);
        expect(await market.feeBps()).to.equal(200);
      });

      it("Should reject fee > 10%", async function () {
        const { market, admin } = await loadFixture(createMarketFixture);
        
        await expect(market.connect(admin).setFeeBps(1001))
          .to.be.revertedWith("max 10%");
      });

      it("Should allow admin to set fee recipient", async function () {
        const { market, admin, user1 } = await loadFixture(createMarketFixture);
        
        await market.connect(admin).setFeeRecipient(user1.address);
        expect(await market.feeRecipient()).to.equal(user1.address);
      });

      it("Should reject zero fee recipient", async function () {
        const { market, admin } = await loadFixture(createMarketFixture);
        
        await expect(market.connect(admin).setFeeRecipient(ethers.ZeroAddress))
          .to.be.revertedWith("zero");
      });

      it("Should allow admin to rescue ERC20 tokens", async function () {
        const { market, admin, settlementToken, user1 } = await loadFixture(createMarketFixture);
        
        const AnotherToken = await ethers.getContractFactory("SettlementToken");
        const anotherToken = await AnotherToken.deploy("Another Token", "ANOTHER");
        await anotherToken.mint(market.target, ethers.parseEther("100"));
        
        await market.connect(admin).rescueERC20(anotherToken.target, user1.address, ethers.parseEther("100"));
        expect(await anotherToken.balanceOf(user1.address)).to.equal(ethers.parseEther("100"));
      });

      it("Should reject rescuing settlement token", async function () {
        const { market, admin, user1 } = await loadFixture(createMarketFixture);
        
        await expect(market.connect(admin).rescueERC20(market.settlementToken(), user1.address, ethers.parseEther("100")))
          .to.be.revertedWith("cannot rescue settlement token");
      });

      it("Should reject admin functions from non-admin", async function () {
        const { market, user1 } = await loadFixture(createMarketFixture);
        
        await expect(market.connect(user1).setFeeBps(200))
          .to.be.revertedWithCustomError(market, "AccessControlUnauthorizedAccount");
        
        await expect(market.connect(user1).setFeeRecipient(user1.address))
          .to.be.revertedWithCustomError(market, "AccessControlUnauthorizedAccount");
      });
    });

    describe("Edge Cases", function () {
      it("Should handle empty pool calculation", async function () {
        const { admin, settlementToken, marketFactory } = await loadFixture(deployContractsFixture);
        
        const question = ethers.id("Empty pools");
        const tx = await marketFactory.connect(admin).createMarket(
          question, 0, 0, 0, 0, ethers.ZeroAddress
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
        
        const marketAddress = marketFactory.interface.parseLog({
          topics: marketDeployedEvent.topics,
          data: marketDeployedEvent.data
        }).args.marketAddress;
        
        const Market = await ethers.getContractFactory("Market");
        const market = Market.attach(marketAddress);
        
        await market.connect(admin).grantRole(await market.ORACLE_ROLE(), admin.address);
        
        await settlementToken.mint(admin.address, ethers.parseEther("1000"));
        await settlementToken.approve(marketAddress, ethers.parseEther("1000"));
        
        await expect(market.connect(admin).buyYes(ethers.parseEther("100")))
          .to.be.revertedWith("empty pool");
      });

      it("Should handle multiple users claiming", async function () {
        const { market, settlementToken, user1, user2, oracle } = await loadFixture(mintTokensFixture);
        
        await market.connect(user1).buyYes(ethers.parseEther("100"));
        await market.connect(user2).buyYes(ethers.parseEther("200"));
        
        await market.connect(oracle).resolve(1);
        
        await expect(market.connect(user1).claim()).to.emit(market, "Claimed");
        await expect(market.connect(user2).claim()).to.emit(market, "Claimed");
        
        expect(await market.yesPositions(user1.address)).to.equal(0);
        expect(await market.yesPositions(user2.address)).to.equal(0);
        expect(await market.totalYesPositions()).to.equal(0);
      });

      it("Should handle precision in CPMM calculations", async function () {
        const { market, user1 } = await loadFixture(mintTokensFixture);
        
        await market.connect(user1).buyYes(ethers.parseEther("1"));
        
        expect(await market.yesPool()).to.be.lt(ethers.parseEther("1000"));
        expect(await market.noPool()).to.be.gt(ethers.parseEther("1000"));
        expect(await market.yesPositions(user1.address)).to.be.gt(0);
      });
    });
  });
});