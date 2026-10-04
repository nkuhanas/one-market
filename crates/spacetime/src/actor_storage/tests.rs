use super::*;

fn actor() -> ActorState {
    ActorState {
        actor_id: u64::MAX,
        bucket: 19,
        cash_cents: u32::MAX.into(),
        shares: u32::MAX.into(),
        marked_equity_cents: u32::MAX.into(),
        initial_endowment_value_cents: u32::MAX.into(),
        life_peak_equity_cents: u32::MAX.into(),
        cumulative_recapitalization_grants_cents: u32::MAX.into(),
        momentum_weight: i16::MIN.into(),
        mean_reversion_weight: i16::MAX.into(),
        contrarian_weight: -1,
        news_weight: 0,
        risk_tolerance_bps: u16::MAX.into(),
        conviction_threshold_bps: u16::MAX.into(),
        last_step_tick: None.into(),
        status: ActorStatus::Active,
        cooldown_started_tick: None.into(),
        lifetime_pnl_cents: i32::MIN.into(),
        wipeout_count: u32::MAX.into(),
        filled_order_count: u32::MAX.into(),
    }
}

#[test]
fn exact_round_trip_and_fixed_width_for_all_flags_and_tick_boundaries() {
    use spacetimedb::sats::bsatn::to_vec;
    for status in [
        ActorStatus::Active,
        ActorStatus::Exiting,
        ActorStatus::Cooldown,
    ] {
        for present in [false, true] {
            for cooldown_present in [false, true] {
                for value in [0, 1, u64::MAX] {
                    for pnl in [i32::MIN, 0, i32::MAX] {
                        let mut a = actor();
                        a.status = status;
                        a.last_step_tick = OptionalTick { value, present };
                        a.cooldown_started_tick = OptionalTick {
                            value,
                            present: cooldown_present,
                        };
                        a.lifetime_pnl_cents = pnl.into();
                        let row = ActorStateCompact::pack(&a).unwrap();
                        assert_eq!(to_vec(&a).unwrap().len(), 132);
                        assert_eq!(to_vec(&row).unwrap().len(), 74);
                        assert_eq!(row.unpack().unwrap(), a);
                    }
                }
            }
        }
    }
}

#[test]
fn every_narrowed_field_falls_back_instead_of_truncating() {
    macro_rules! rejects {
        ($field:ident, $value:expr) => {{
            let mut a = actor();
            a.$field = $value;
            assert!(ActorStateCompact::pack(&a).is_none(), stringify!($field));
        }};
    }
    macro_rules! unsigned {
        ($limit:expr, $($field:ident),+ $(,)?) => {$({
            rejects!($field, u64::from($limit) + 1);
            rejects!($field, u64::MAX);
        })+};
    }
    unsigned!(
        u32::MAX,
        cash_cents,
        shares,
        marked_equity_cents,
        initial_endowment_value_cents,
        life_peak_equity_cents,
        cumulative_recapitalization_grants_cents,
        wipeout_count,
        filled_order_count
    );
    unsigned!(u16::MAX, risk_tolerance_bps, conviction_threshold_bps);
    for value in [
        i32::from(i16::MIN) - 1,
        i32::from(i16::MAX) + 1,
        i32::MIN,
        i32::MAX,
    ] {
        rejects!(momentum_weight, value);
        rejects!(mean_reversion_weight, value);
        rejects!(contrarian_weight, value);
        rejects!(news_weight, value);
    }
    for value in [
        i64::from(i32::MIN) - 1,
        i64::from(i32::MAX) + 1,
        i64::MIN,
        i64::MAX,
    ] {
        rejects!(lifetime_pnl_cents, value);
    }
}

#[test]
fn rejects_all_reserved_flags_and_statuses() {
    for flags in 0..=u8::MAX {
        let mut row = ActorStateCompact::pack(&actor()).unwrap();
        row.flags = flags;
        assert_eq!(row.unpack().is_ok(), flags & !15 == 0 && flags & 3 != 3);
    }
}
