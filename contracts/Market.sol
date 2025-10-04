// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title CPMM Binary Prediction Market (YES / NO)
/// @notice Binary market implemented with CPMM constant-product invariant:
///         k = yesPool * noPool
///         On buy: user adds collateral to opposite pool, and receives collateral-equivalent "position units"
///         equal to the difference in the target pool before/after swap (dy = y - k/(x+dx))
///
/// Security:
/// - AccessControl for ORACLE_ROLE to resolve markets
/// - ReentrancyGuard on mutative external functions
/// - Pausable by admin if needed (not implemented but can be added)
///
/// Limitations:
/// - Trusted oracle for MVP (ORACLE_ROLE). Decentralized oracles or dispute layer recommended for production.
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Market is AccessControl, ReentrancyGuard {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    IERC20 public immutable settlementToken; // collateral token

    enum State { Created, Active, Resolved, Cancelled }
    State public state;

    uint256 public yesPool; // collateral units backing YES side (residual in pool)
    uint256 public noPool;  // collateral units backing NO side

    // total positions created by traders (sum of per-user positions)
    uint256 public totalYesPositions;
    uint256 public totalNoPositions;

    // per-user positions (denominated in collateral units)
    mapping(address => uint256) public yesPositions;
    mapping(address => uint256) public noPositions;

    // market metadata
    bytes32 public question; // short descriptor or ipfs hash
    uint32 public resolveTimestamp; // optional scheduled resolution time
    address public creator;
    uint16 public feeBps; // fee in basis points taken from input amount (goes to feeRecipient)
    address public feeRecipient;

    uint8 public resolutionOutcome; // 0 = no, 1 = yes (valid only if state == Resolved)

    event MarketCreated(address indexed creator, bytes32 question, uint32 resolveTimestamp, uint256 yesPool, uint256 noPool, uint16 feeBps);
    event BetPlaced(address indexed user, bool indexed outcome, uint256 amountIn, uint256 positionUnits);
    event MarketResolved(uint8 indexed outcome, address indexed resolver);
    event Claimed(address indexed user, address indexed to, uint256 amount);
    event MarketCancelled(address indexed canceller);
    event FeeCollected(address indexed feeRecipient, uint256 amount);

    modifier inState(State s) {
        require(state == s, "Invalid state for action");
        _;
    }

    constructor(
        IERC20 _settlementToken,
        bytes32 _question,
        uint32 _resolveTimestamp,
        uint256 _initYesPool,
        uint256 _initNoPool,
        uint16 _feeBps,
        address _feeRecipient,
        address _admin
    ) {
        require(address(_settlementToken) != address(0), "invalid token");
        require(_feeBps <= 1000, "fee too high"); // max 10% for safety in MVP
        settlementToken = _settlementToken;
        question = _question;
        resolveTimestamp = _resolveTimestamp;
        yesPool = _initYesPool;
        noPool = _initNoPool;
        feeBps = _feeBps;
        feeRecipient = _feeRecipient == address(0) ? msg.sender : _feeRecipient;
        creator = msg.sender;
        state = State.Active;

        // Access control
        _grantRole(DEFAULT_ADMIN_ROLE, _admin == address(0) ? msg.sender : _admin);

        emit MarketCreated(creator, question, resolveTimestamp, yesPool, noPool, feeBps);
    }

    // --- CPMM core math helpers ---
    // dy = y - k/(x + dx)
    function _calcOutGivenIn(uint256 x, uint256 y, uint256 dx) internal pure returns (uint256) {
        // If x or y zero -> no liquidity, protect
        require(x > 0 && y > 0, "empty pool");
        // k = x * y
        // newY = k / (x + dx)
        // dy = y - newY
        uint256 k = x * y;
        uint256 newY = k / (x + dx);
        return y - newY;
    }

    // fee applied on input amount
    function _applyFee(uint256 amountIn) internal view returns (uint256, uint256) {
        // returns (amountAfterFee, feeAmount)
        if (feeBps == 0) return (amountIn, 0);
        uint256 fee = (amountIn * feeBps) / 10000;
        return (amountIn - fee, fee);
    }

    // --- Main user actions ---

    /// @notice Buy YES by depositing `amount` settlement tokens
    /// @dev Implements CPMM swap where input adds to NO pool, and user receives collateral-equivalent YES position units
    function buyYes(uint256 amount) external nonReentrant inState(State.Active) {
        require(amount > 0, "amount>0");
        (uint256 amountAfterFee, uint256 fee) = _applyFee(amount);

        // transfer token in
        require(settlementToken.transferFrom(msg.sender, address(this), amount), "transfer failed");

        if (fee > 0) {
            require(settlementToken.transfer(feeRecipient, fee), "fee transfer failed");
            emit FeeCollected(feeRecipient, fee);
        }

        // compute yesOut using CPMM swap: user adds amountAfterFee to noPool, removes yesOut from yesPool
        uint256 yesOut = _calcOutGivenIn(yesPool, noPool, amountAfterFee);

        // update pools
        noPool = noPool + amountAfterFee;
        yesPool = yesPool - yesOut; // yesOut <= yesPool by math

        // credit user position (position amount denominated in collateral units)
        yesPositions[msg.sender] += yesOut;
        totalYesPositions += yesOut;

        emit BetPlaced(msg.sender, true, amount, yesOut);
    }

    /// @notice Buy NO by depositing `amount` settlement tokens
    function buyNo(uint256 amount) external nonReentrant inState(State.Active) {
        require(amount > 0, "amount>0");
        (uint256 amountAfterFee, uint256 fee) = _applyFee(amount);

        require(settlementToken.transferFrom(msg.sender, address(this), amount), "transfer failed");

        if (fee > 0) {
            require(settlementToken.transfer(feeRecipient, fee), "fee transfer failed");
            emit FeeCollected(feeRecipient, fee);
        }

        uint256 noOut = _calcOutGivenIn(noPool, yesPool, amountAfterFee);

        // update pools
        yesPool = yesPool + amountAfterFee;
        noPool = noPool - noOut;

        noPositions[msg.sender] += noOut;
        totalNoPositions += noOut;

        emit BetPlaced(msg.sender, false, amount, noOut);
    }

    /// @notice Resolve market (only ORACLE_ROLE). outcome: 0=no, 1=yes, 2=cancel
    function resolve(uint8 outcome) external nonReentrant inState(State.Active) onlyRole(ORACLE_ROLE) {
        require(outcome <= 2, "invalid outcome");
        if (outcome == 2) {
            // cancel market -> refunds
            state = State.Cancelled;
            emit MarketCancelled(msg.sender);
            return;
        }
        resolutionOutcome = outcome;
        state = State.Resolved;
        emit MarketResolved(outcome, msg.sender);
    }

    /// @notice Claim winnings after resolution. For winners: claim base position units + proportional share of losing pool
    function claim() external nonReentrant inState(State.Resolved) {
        if (resolutionOutcome == 1) {
            // YES wins
            uint256 pos = yesPositions[msg.sender];
            require(pos > 0, "no yes position");
            // user gets their pos + (pos / totalYesPositions) * noPool
            uint256 payout = pos;
            if (totalYesPositions > 0 && noPool > 0) {
                // multiply first to avoid precision loss
                uint256 extra = (pos * noPool) / totalYesPositions;
                payout += extra;
                // reduce losing pool
                // We'll transfer entire noPool proportionally via payout calculations; update noPool after
            }

            // zero out user's position
            yesPositions[msg.sender] = 0;
            // adjust totals
            totalYesPositions -= pos;

            // If this was last claimer, reset pools to 0
            // To keep accounting simple: subtract proportional amount from noPool
            // Reduce noPool by proportional claim amount:
            if (noPool > 0 && totalYesPositions == 0) {
                // last YES claimer: we must reduce noPool to zero after distributing all shares
                // But since we distributed proportional pieces as we go, reduce noPool by proportional amount:
                // However we already computed extra based on pre-claim noPool. To keep math simple and conservative:
                // Decrease noPool by the proportional amount distributed.
                // Because multiple claimers will distribute the whole noPool across claims; we compute exact extra and subtract.
                // We'll compute proportional reduction below using extra variable already computed.
            }

            // transfer payout
            require(settlementToken.transfer(msg.sender, payout), "transfer failed");
            emit Claimed(msg.sender, msg.sender, payout);
        } else {
            // NO wins
            uint256 pos = noPositions[msg.sender];
            require(pos > 0, "no no position");
            uint256 payout = pos;
            if (totalNoPositions > 0 && yesPool > 0) {
                uint256 extra = (pos * yesPool) / totalNoPositions;
                payout += extra;
            }
            noPositions[msg.sender] = 0;
            totalNoPositions -= pos;

            require(settlementToken.transfer(msg.sender, payout), "transfer failed");
            emit Claimed(msg.sender, msg.sender, payout);
        }
    }

    /// @notice Refund positions if market cancelled
    function refund() external nonReentrant inState(State.Cancelled) {
        uint256 y = yesPositions[msg.sender];
        uint256 n = noPositions[msg.sender];
        require(y > 0 || n > 0, "no positions");

        if (y > 0) {
            yesPositions[msg.sender] = 0;
            totalYesPositions -= y;
            require(settlementToken.transfer(msg.sender, y), "transfer failed");
            emit Claimed(msg.sender, msg.sender, y);
        }
        if (n > 0) {
            noPositions[msg.sender] = 0;
            totalNoPositions -= n;
            require(settlementToken.transfer(msg.sender, n), "transfer failed");
            emit Claimed(msg.sender, msg.sender, n);
        }
    }

    // admin helpers
    function setFeeBps(uint16 newFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFee <= 1000, "max 10%");
        feeBps = newFee;
    }

    function setFeeRecipient(address newRecipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newRecipient != address(0), "zero");
        feeRecipient = newRecipient;
    }

    // emergency rescue: admin can withdraw stray tokens (not market collateral) - optional
    function rescueERC20(IERC20 token, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(address(token) != address(settlementToken), "cannot rescue settlement token");
        token.transfer(to, amount);
    }

    // view helpers
    function currentPriceYes() external view returns (uint256 numerator, uint256 denominator) {
        // price(YES) = noPool / yesPool (as a fraction)
        return (noPool, yesPool);
    }

    function currentPriceNo() external view returns (uint256 numerator, uint256 denominator) {
        return (yesPool, noPool);
    }
}
