// Canned seats for tests and dry runs. No network.
import { NAMES, makeSeat } from './staff.mjs'

export function mockSeats({ resolveAt = 5, fail } = {}) {
  let count = 0
  const seats = {}
  for (const name of NAMES) {
    const seat = makeSeat(name, 'mock')
    seat.reply = async () => {
      count++
      if (fail === count) throw new Error('simulated outage')
      const next = NAMES[(NAMES.indexOf(name) + 1) % NAMES.length]
      const extra = count === 2 ? '\nCEO DECISION: approve the live test window' : ''
      return count >= resolveAt
        ? `${name} (mock) summarises the plan.${extra}\n[RESOLVED]`
        : `${name} (mock) turn ${count}.${extra}\nNEXT: ${next}`
    }
    seats[name] = seat
  }
  return seats
}
