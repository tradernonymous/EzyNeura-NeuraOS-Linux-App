//! One GPU, two servers: llama-server (chat) and sd-server (images) each
//! claim VRAM on their own, and on a small card a chat model loading while an
//! image draws is an OOM the killer resolves for you. This ledger records
//! what each has reserved against the card's own VRAM, so the second one to
//! start is told in words instead of taking the machine down.
//!
//! Ponytail ceiling: a reservation is a file-size estimate, not a measured
//! allocation — the upgrade is reading each server's real usage per pid once
//! it is up. An unknown ceiling (no report from the machine) records but
//! never refuses: the previous behaviour, kept.
use std::sync::Mutex;

/// What each server claimed, in MB. One server per slot, so a start REPLACES.
static LLAMA: Mutex<u64> = Mutex::new(0);
static SD: Mutex<u64> = Mutex::new(0);

fn read(slot: &Mutex<u64>) -> u64 {
    *slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn write(slot: &Mutex<u64>, mb: u64) {
    *slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = mb;
}

/// The card's VRAM in MB as the machine reports it, or None when it reports
/// nothing (the ledger then records and never refuses).
pub fn ceiling_mb() -> Option<u64> {
    crate::models::vram_mb().filter(|mb| *mb > 0)
}

/// MB both servers hold together.
pub fn held_mb() -> u64 {
    read(&LLAMA).saturating_add(read(&SD))
}

/// VRAM a starting server may plan against: the card minus what the other
/// server holds. None when the card reports nothing (nothing to plan against).
pub fn available_mb() -> Option<u64> {
    ceiling_mb().map(|ceiling| ceiling.saturating_sub(held_mb()))
}

/// Does this claim fit on the card? Pure, so the rule is testable without a
/// GPU: `ceiling: None` fits anything (no report, no refusal).
fn fits(held: u64, need: u64, ceiling: Option<u64>) -> Result<(), u64> {
    match ceiling {
        None => Ok(()),
        Some(ceiling) if held.saturating_add(need) > ceiling.saturating_mul(9) / 10 => Err(held),
        Some(_) => Ok(()),
    }
}

/// Record what llama-server will hold. Never refuses: its layer fit was
/// already computed against `available_mb`, so what it claims fits by
/// construction — this only tells the NEXT server to start.
pub fn take_llama(mb: u64) {
    write(&LLAMA, mb);
}

/// Record what sd-server will hold, or say why it may not start.
pub fn take_sd(mb: u64) -> Result<(), String> {
    let ceiling = ceiling_mb();
    if let Err(held) = fits(read(&LLAMA), mb, ceiling) {
        return Err(format!(
            "The image server needs about {} MB of VRAM, and the local model already holds about {} MB of the {} MB card. Stop the local model in Settings → Local models, then draw again.",
            mb, held, ceiling.unwrap_or(0)
        ));
    }
    write(&SD, mb);
    Ok(())
}

/// The server is down: its slot is empty again. Called from both shutdowns,
/// whether or not a reservation was made.
pub fn give_llama() {
    write(&LLAMA, 0);
}

pub fn give_sd() {
    write(&SD, 0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_claim_fits_only_while_the_card_does() {
        // A 4 GB card: 90% is the line both servers plan against.
        assert!(fits(0, 3000, Some(4096)).is_ok(), "first server fits");
        assert_eq!(fits(3000, 1000, Some(4096)), Err(3000), "the second does not");
        assert!(fits(1000, 1000, Some(4096)).is_ok(), "a smaller second one does");
        assert_eq!(fits(3000, 1000, Some(4096)).unwrap_err(), 3000, "the caller is told what is held");
    }

    #[test]
    fn no_report_means_no_refusal() {
        assert!(fits(0, 1 << 40, None).is_ok());
        assert!(fits(1 << 40, 1 << 40, None).is_ok());
    }

    #[test]
    fn slots_release_again() {
        take_llama(1234);
        assert_eq!(read(&LLAMA), 1234);
        give_llama();
        assert_eq!(read(&LLAMA), 0);
    }
}
