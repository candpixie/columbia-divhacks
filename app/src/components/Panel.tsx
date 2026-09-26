import type { Person, TimesState } from '../types'
import { BudgetField, PlacesField, PrioritiesField, type SetPerson } from '../fields/Fields'
import { STEPS } from '../onboarding/constants'
import { Mark } from '../onboarding/icons'

type Props = {
  person: Person
  setPerson: SetPerson
  times: TimesState
  counts: { green: number; yellow: number; gray: number }
}

// Same fields, same order, same labels as the onboarding wizard (see fields/Fields.tsx)
const title = (id: string) => STEPS.find((s) => s.id === id)!.k

export function Panel({ person, setPerson, times, counts }: Props) {
  return (
    <aside className="ms-panel">
      <div className="ms-head">
        <Mark />
      </div>

      <section className="ms-sec">
        <h2 className="ms-h">{title('budget')}</h2>
        <BudgetField person={person} setPerson={setPerson} compact />
      </section>

      <section className="ms-sec">
        <h2 className="ms-h">{title('places')}</h2>
        <PlacesField person={person} setPerson={setPerson} times={times} compact />
      </section>

      <section className="ms-sec">
        <h2 className="ms-h">{title('rank')}</h2>
        <PrioritiesField person={person} setPerson={setPerson} compact />
      </section>

      <section className="ms-sec ms-legend">
        <div>
          <i className="ms-sw green" /> Fits <b>{counts.green}</b>
        </div>
        <div>
          <i className="ms-sw yellow" /> Close <b>{counts.yellow}</b>
        </div>
        <div>
          <i className="ms-sw gray" /> Out <b>{counts.gray}</b>
        </div>
      </section>
    </aside>
  )
}
