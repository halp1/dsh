window.__ModuleLoader__.load({
  id: 'dsh-plugin-jev-reviewer',
  factory: (require) => {
    const React = require('react')
    const { Button } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const namespace = 'jev-reviewer'
    const css = `
      .jev-settings {
        padding: 24px;
        max-width: 560px;
        color: var(--dsw-alias-label-primary);
      }
      .jev-settings h2 {
        font-size: 18px;
        font-weight: 600;
        margin: 0 0 28px;
      }
      .jev-settings form {
        display: grid;
        gap: 12px;
      }
      .jev-settings label {
        font-size: 14px;
        font-weight: 600;
      }
      .jev-settings p {
        margin: 0;
        font-size: 13px;
        line-height: 1.6;
        color: var(--dsw-alias-label-secondary);
      }
      .jev-settings input {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        padding: 10px 12px;
        border: 1px solid var(--dsw-alias-border-l4);
        border-radius: 8px;
        color: inherit;
        background: var(--dsw-alias-bg-layer-1);
        font: inherit;
        caret-color: var(--dsw-static-deepseek-450);
      }
      .jev-settings input::placeholder {
        color: var(--dsw-alias-label-tertiary);
      }
      .jev-settings input:focus-visible {
        outline: 2px solid var(--dsw-static-deepseek-450);
        outline-offset: 2px;
      }
      .jev-settings input:disabled {
        opacity: 0.6;
      }
      .jev-settings .jev-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
      }
      .jev-settings [role=alert] {
        color: var(--dsw-alias-state-error-primary);
      }
    `

    function SettingsPage({ form, mirror }) {
      const snapshot = React.useSyncExternalStore(
        (notify) => form.subscribe(notify), () => form.getSnapshot(), () => form.getSnapshot(),
      )
      const described = React.useSyncExternalStore(
        (notify) => mirror.subscribe(notify), () => mirror.getSnapshot(), () => mirror.getSnapshot(),
      )
      const [draft, setDraft] = React.useState('')
      const [revision, setRevision] = React.useState(undefined)
      const [busy, setBusy] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const fieldId = React.useId()
      const descriptor = described.view?.namespaces.find((entry) => entry.ns === namespace)
      const keySaved = descriptor?.secrets?.some((entry) => entry.path.length === 1 && entry.path[0] === 'apiKey' && entry.set) === true
      const writable = snapshot.status === 'ready' && snapshot.writable
      const ready = writable && busy === null

      async function save(event) {
        event.preventDefault()
        if (!ready) return
        const credential = draft.trim()
        if (!credential || credential.length > 4096 || /[\s\p{Cc}\p{Cf}]/u.test(credential)) {
          setNotice({ error: true, text: 'Enter a key without spaces or control characters.' })
          return
        }
        setBusy('save')
        setNotice(null)
        try {
          const accepted = await form.mutate([{ op: 'set', path: ['apiKey'], value: credential }], revision ?? snapshot.revision)
          if (accepted) {
            setDraft('')
            setRevision(undefined)
            setNotice({ text: 'API key saved. New reviews use it immediately.' })
          } else {
            setRevision(form.getSnapshot().revision)
            setNotice({ error: true, text: 'Settings changed or the save was refused. Review your draft and try again.' })
          }
        } catch {
          setNotice({ error: true, text: 'Could not save the key. Check the connection and try again.' })
        } finally {
          setBusy(null)
        }
      }

      async function reset() {
        if (!ready || draft) return
        setBusy('reset')
        setNotice(null)
        try {
          const accepted = await form.mutate([{ op: 'unset', path: ['apiKey'] }], snapshot.revision)
          setNotice(accepted
            ? { text: 'Key reset. The inherited setting or environment variable will be used.' }
            : { error: true, text: 'Settings changed or the reset was refused. Try again.' })
        } catch {
          setNotice({ error: true, text: 'Could not reset the key. Check the connection and try again.' })
        } finally {
          setBusy(null)
        }
      }

      const status = snapshot.status === 'loading' ? 'Loading settings...' :
        !writable ? 'Settings are unavailable or read-only on this host.' :
        keySaved ? 'A key is saved on this DSH host.' :
        'No key saved. TYPESAFE_API_KEY is used when available.'
      return h('section', { className: 'jev-settings', 'aria-label': 'Jev reviewer settings' },
        h('h2', null, 'Jev reviewer'),
        h('form', { onSubmit: save, 'aria-busy': busy !== null },
          h('label', { htmlFor: fieldId }, 'TypeSafe API key'),
          h('p', { id: `${fieldId}-status` }, status),
          h('input', {
            id: fieldId, name: 'jev-api-key', type: 'password', value: draft,
            autoComplete: 'new-password', autoCapitalize: 'none', spellCheck: false,
            maxLength: 4096, disabled: !ready, placeholder: keySaved ? 'Enter a replacement key' : 'Enter your API key',
            'aria-describedby': `${fieldId}-status ${fieldId}-storage`,
            onChange: (event) => {
              if (!draft) setRevision(snapshot.revision)
              setDraft(event.target.value)
              setNotice(null)
            },
          }),
          h('p', { id: `${fieldId}-storage` }, 'Saved in your DSH profile, not encrypted. The saved key is never sent back to this page.'),
          h('div', { className: 'jev-actions' },
            h(Button, { type: 'submit', size: 'sm', disabled: !ready || !draft.trim() }, busy === 'save' ? 'Saving...' : 'Save key'),
            keySaved && h(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: !ready || !!draft, onClick: reset }, busy === 'reset' ? 'Resetting...' : 'Reset key'),
          ),
          notice && h('p', { role: notice.error ? 'alert' : 'status', 'aria-live': 'polite' }, notice.text),
        ),
      )
    }

    return {
      name: 'jev-reviewer-settings',
      inject: ['slots', 'configForms'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = css
          document.head.append(style)
          return () => style.remove()
        })
        ctx.effect(() => ctx.configForms.whileServed([namespace], () =>
          ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section', id: namespace, label: 'Jev reviewer', order: 55,
            inject: () => ({ form: ctx.configForms.get(namespace), mirror: ctx.configForms.describe() }),
          }, SettingsPage)),
        ))
      },
    }
  },
})
