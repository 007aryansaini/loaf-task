// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./Market.sol";


contract MarketFactory is AccessControl {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    address[] public markets;
    IERC20 public settlementToken;

    event MarketDeployed(address indexed marketAddress, address indexed creator, bytes32 question);

    constructor(IERC20 _settlementToken, address admin) {
        settlementToken = _settlementToken;
        _grantRole(DEFAULT_ADMIN_ROLE, admin == address(0) ? msg.sender : admin);
    }

    function createMarket(
        bytes32 question,
        uint32 resolveTimestamp,
        uint256 initYesPool,
        uint256 initNoPool,
        uint16 feeBps,
        address feeRecipient
    ) external returns (address) {
        // Caller must transfer initial liquidity to deployed market after creation
        Market m = new Market(
            settlementToken,
            question,
            resolveTimestamp,
            initYesPool,
            initNoPool,
            feeBps,
            feeRecipient,
            msg.sender // admin of market set to caller; factory does not assume admin rights
        );

        markets.push(address(m));
        emit MarketDeployed(address(m), msg.sender, question);

        return address(m);
    }

    function numMarkets() external view returns (uint256) {
        return markets.length;
    }

    function getMarkets() external view returns (address[] memory) {
        return markets;
    }
}
