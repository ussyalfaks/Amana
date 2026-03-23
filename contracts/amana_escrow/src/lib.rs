#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, Address, Env, Symbol};

const ADMIN: Symbol = symbol_short!("ADMIN");
const TREASURY: Symbol = symbol_short!("TREASURY");
const FEE_BPS: Symbol = symbol_short!("FEE_BPS");
const FUNDS_RELEASED: Symbol = symbol_short!("RELSD");
const DELIVERY_CONFIRMED: Symbol = symbol_short!("DELCNF");
const BPS_DIVISOR: i128 = 10_000;

#[derive(Clone)]
#[contracttype]
pub enum TradeStatus {
    Funded,
    Delivered,
    Completed,
}

#[derive(Clone)]
#[contracttype]
pub struct Trade {
    pub trade_id: u64,
    pub buyer: Address,
    pub seller: Address,
    pub token: Address,
    pub amount: i128,
    pub status: TradeStatus,
    pub delivered_at: Option<u64>,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Trade(u64),
}

#[derive(Clone)]
#[contracttype]
pub struct FundsReleasedEvent {
    pub trade_id: u64,
    pub seller_amount: i128,
    pub fee_amount: i128,
}

#[derive(Clone)]
#[contracttype]
pub struct DeliveryConfirmedEvent {
    pub trade_id: u64,
    pub delivered_at: u64,
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    pub fn initialize(env: Env, admin: Address, treasury: Address, fee_bps: u32) {
        admin.require_auth();
        assert!(fee_bps <= BPS_DIVISOR as u32, "invalid fee_bps");
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&TREASURY, &treasury);
        env.storage().instance().set(&FEE_BPS, &fee_bps);
    }

    pub fn create_trade(
        env: Env,
        trade_id: u64,
        buyer: Address,
        seller: Address,
        token: Address,
        amount: i128,
    ) {
        buyer.require_auth();
        assert!(amount > 0, "amount must be positive");
        let key = DataKey::Trade(trade_id);
        assert!(
            env.storage().persistent().get::<_, Trade>(&key).is_none(),
            "trade already exists"
        );
        env.storage().persistent().set(
            &key,
            &Trade {
                trade_id,
                buyer,
                seller,
                token,
                amount,
                status: TradeStatus::Funded,
                delivered_at: None,
            },
        );
    }

    pub fn confirm_delivery(env: Env, trade_id: u64) {
        let key = DataKey::Trade(trade_id);
        let mut trade: Trade = env.storage().persistent().get(&key).unwrap();
        let invoker = env.invoker();
        assert!(invoker == trade.buyer, "only buyer can confirm delivery");
        trade.buyer.require_auth();
        assert!(
            matches!(trade.status, TradeStatus::Funded),
            "trade must be funded"
        );
        let delivered_at = env.ledger().timestamp();
        trade.status = TradeStatus::Delivered;
        trade.delivered_at = Some(delivered_at);
        env.storage().persistent().set(&key, &trade);
        env.events().publish(
            (DELIVERY_CONFIRMED, trade_id),
            DeliveryConfirmedEvent {
                trade_id,
                delivered_at,
            },
        );
    }

    pub fn release_funds(env: Env, trade_id: u64) {
        let key = DataKey::Trade(trade_id);
        let mut trade: Trade = env.storage().persistent().get(&key).unwrap();
        assert!(
            matches!(trade.status, TradeStatus::Delivered),
            "trade must be delivered"
        );

        let admin: Address = env.storage().instance().get(&ADMIN).unwrap();
        let invoker = env.invoker();
        if invoker == trade.buyer {
            trade.buyer.require_auth();
        } else if invoker == admin {
            admin.require_auth();
        } else {
            panic!("only buyer or admin can release");
        }

        let fee_bps: u32 = env.storage().instance().get(&FEE_BPS).unwrap();
        let treasury: Address = env.storage().instance().get(&TREASURY).unwrap();
        let fee_amount = trade.amount * fee_bps as i128 / BPS_DIVISOR;
        let seller_amount = trade.amount - fee_amount;

        let token_client = token::Client::new(&env, &trade.token);
        token_client.transfer(&env.current_contract_address(), &trade.seller, &seller_amount);
        token_client.transfer(&env.current_contract_address(), &treasury, &fee_amount);

        trade.status = TradeStatus::Completed;
        env.storage().persistent().set(&key, &trade);

        env.events().publish(
            (FUNDS_RELEASED, trade_id),
            FundsReleasedEvent {
                trade_id,
                seller_amount,
                fee_amount,
            },
        );
    }

    pub fn get_trade(env: Env, trade_id: u64) -> Trade {
        let key = DataKey::Trade(trade_id);
        env.storage().persistent().get(&key).unwrap()
    }
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token, Address, Env,
    };

    #[contract]
    struct MockTokenContract;

    #[derive(Clone)]
    #[contracttype]
    enum MockTokenDataKey {
        Balance(Address),
    }

    #[contractimpl]
    impl MockTokenContract {
        pub fn mint(env: Env, to: Address, amount: i128) {
            let key = MockTokenDataKey::Balance(to.clone());
            let current = env.storage().persistent().get::<_, i128>(&key).unwrap_or(0);
            env.storage().persistent().set(&key, &(current + amount));
        }

        pub fn balance(env: Env, owner: Address) -> i128 {
            env.storage()
                .persistent()
                .get(&MockTokenDataKey::Balance(owner))
                .unwrap_or(0)
        }

        pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
            assert!(amount >= 0, "invalid amount");
            let from_key = MockTokenDataKey::Balance(from.clone());
            let to_key = MockTokenDataKey::Balance(to.clone());

            let from_balance = env.storage().persistent().get::<_, i128>(&from_key).unwrap_or(0);
            assert!(from_balance >= amount, "insufficient balance");
            let to_balance = env.storage().persistent().get::<_, i128>(&to_key).unwrap_or(0);

            env.storage().persistent().set(&from_key, &(from_balance - amount));
            env.storage().persistent().set(&to_key, &(to_balance + amount));
        }
    }

    fn setup_trade(env: &Env, amount: i128, fee_bps: u32) -> (Address, Address, Address, Address, u64) {
        let admin = Address::generate(env);
        let buyer = env.invoker();
        let seller = Address::generate(env);
        let treasury = Address::generate(env);
        let trade_id = 1_u64;

        let escrow_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(env, &escrow_id);
        let token_id = env.register(MockTokenContract, ());
        let token_client = MockTokenContractClient::new(env, &token_id);

        token_client.mint(&escrow_id, &amount);
        client.initialize(&admin, &treasury, &fee_bps);
        client.create_trade(&trade_id, &buyer, &seller, &token_id, &amount);
        client.confirm_delivery(&trade_id);

        (escrow_id, token_id, seller, treasury, trade_id)
    }

    #[test]
    fn test_release_sends_correct_amount_to_seller() {
        let env = Env::default();
        env.mock_all_auths();
        let amount = 10_000_i128;
        let fee_bps = 100_u32;
        let (escrow_id, token_id, seller, treasury, trade_id) = setup_trade(&env, amount, fee_bps);

        let client = EscrowContractClient::new(&env, &escrow_id);
        let token_client = MockTokenContractClient::new(&env, &token_id);

        client.release_funds(&trade_id);

        assert_eq!(token_client.balance(&seller), 9_900);
        assert_eq!(token_client.balance(&treasury), 100);
        assert_eq!(token_client.balance(&escrow_id), 0);
    }

    #[test]
    fn test_confirm_delivery_transitions_to_delivered() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = 1_700_000_000);
        let admin = Address::generate(&env);
        let buyer = env.invoker();
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let amount = 10_000_i128;
        let trade_id = 42_u64;

        let escrow_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &escrow_id);
        let token_id = env.register(MockTokenContract, ());
        let token_client = MockTokenContractClient::new(&env, &token_id);
        token_client.mint(&escrow_id, &amount);

        client.initialize(&admin, &treasury, &100);
        client.create_trade(&trade_id, &buyer, &seller, &token_id, &amount);
        client.confirm_delivery(&trade_id);

        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Delivered));
        assert_eq!(trade.delivered_at, Some(1_700_000_000));
    }

    #[test]
    #[should_panic(expected = "only buyer can confirm delivery")]
    fn test_confirm_delivery_fails_if_not_buyer() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let amount = 10_000_i128;
        let trade_id = 43_u64;

        let escrow_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &escrow_id);
        let token_id = env.register(MockTokenContract, ());
        let token_client = MockTokenContractClient::new(&env, &token_id);
        token_client.mint(&escrow_id, &amount);

        client.initialize(&admin, &treasury, &100);
        client.create_trade(&trade_id, &buyer, &seller, &token_id, &amount);
        client.confirm_delivery(&trade_id);
    }

    #[test]
    #[should_panic(expected = "trade must be funded")]
    fn test_confirm_delivery_fails_if_not_in_funded_state() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let amount = 10_000_i128;
        let trade_id = 44_u64;

        let escrow_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &escrow_id);
        let token_id = env.register(MockTokenContract, ());
        let token_client = MockTokenContractClient::new(&env, &token_id);
        token_client.mint(&escrow_id, &amount);

        client.initialize(&admin, &treasury, &100);
        client.create_trade(&trade_id, &buyer, &seller, &token_id, &amount);
        client.confirm_delivery(&trade_id);
        client.confirm_delivery(&trade_id);
    }

    #[test]
    fn test_release_sends_correct_fee_to_treasury() {
        let env = Env::default();
        env.mock_all_auths();
        let amount = 50_000_i128;
        let fee_bps = 100_u32;
        let (escrow_id, token_id, _seller, treasury, trade_id) = setup_trade(&env, amount, fee_bps);

        let client = EscrowContractClient::new(&env, &escrow_id);
        let token_client = MockTokenContractClient::new(&env, &token_id);

        client.release_funds(&trade_id);
        assert_eq!(token_client.balance(&treasury), 500);
    }

    #[test]
    #[should_panic(expected = "trade must be delivered")]
    fn test_release_fails_if_not_in_delivered_state() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let amount = 10_000_i128;
        let trade_id = 9_u64;

        let escrow_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &escrow_id);
        let token_id = env.register(MockTokenContract, ());
        let token_client = MockTokenContractClient::new(&env, &token_id);
        token_client.mint(&escrow_id, &amount);

        client.initialize(&admin, &treasury, &100);
        client.create_trade(&trade_id, &buyer, &seller, &token_id, &amount);
        client.release_funds(&trade_id);
    }

    #[test]
    fn test_fee_calculation_rounds_correctly() {
        let env = Env::default();
        env.mock_all_auths();
        let amount = 101_i128;
        let fee_bps = 100_u32; // 1%
        let (escrow_id, token_id, seller, treasury, trade_id) = setup_trade(&env, amount, fee_bps);

        let client = EscrowContractClient::new(&env, &escrow_id);
        let token_client = MockTokenContractClient::new(&env, &token_id);

        client.release_funds(&trade_id);

        assert_eq!(token_client.balance(&treasury), 1);
        assert_eq!(token_client.balance(&seller), 100);
    }
}
