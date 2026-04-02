import { AboutDialog } from 'handfish'

const about = new AboutDialog({
    name: 'Foundry',
    version: '0.9.0',
    logo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" fill="currentColor"><g transform="translate(0,600) scale(0.1,-0.1)"><path d="M883 4443 l677 -678 672 -2 671 -1 -679 679 -679 679 -670 0 -670 0 678 -677z"/><path d="M2308 4449 c370 -368 681 -673 692 -677 10 -4 315 -6 677 -4 l658 3 -680 674 -680 674 -670 0 -670 0 673 -670z"/><path d="M3753 4440 l682 -680 650 1 c358 0 656 3 663 8 8 5 -208 227 -662 679 l-675 672 -670 0 -669 0 681 -680z"/><path d="M1660 3673 c0 -4 305 -310 678 -680 l677 -672 670 0 670 -1 -681 680 -681 680 -667 0 c-366 0 -666 -3 -666 -7z"/><path d="M3765 3000 l680 -680 670 0 670 0 -680 680 -680 680 -670 0 -670 0 680 -680z"/><path d="M3780 1555 l675 -675 671 0 672 0 -676 675 -677 675 -670 0 -670 0 675 -675z"/></g></svg>`,
    titleFont: "'Victor Mono', 'Victor Mono Block'",
    repo: 'noisefactorllc/effect-workspace',
    ecosystem: 'Foundry is a free tool by <a href="https://noisefactor.io/" target="_blank" rel="noopener">Noise Factor</a>, powered by the <a href="https://noisemaker.app/" target="_blank" rel="noopener">Noisemaker</a> open source engine. <a href="https://noisedeck.app/" target="_blank" rel="noopener">Noisedeck</a> is our video synth. Free to use, with a $4/mo subscription for pro features.',
})

fetch('./deployment-meta.json', { cache: 'no-store' }).then(async (res) => {
    if (!res.ok) return
    const data = await res.json()
    const hash = data.git_hash?.trim().slice(0, 8) || 'LOCAL'
    let deployed = 'n/a'
    if (data.date) {
        const d = new Date(data.date * 1000)
        const pad = (n) => String(n).padStart(2, '0')
        deployed = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    about.setBuild({ hash, deployed })
}).catch(() => {})

fetch('https://shaders.noisedeck.app/0.9.0/noisemaker-shaders-core.esm.js', { cache: 'no-store' }).then(async (res) => {
    if (!res.ok) return
    const reader = res.body.getReader()
    const { value } = await reader.read()
    reader.cancel()
    const match = new TextDecoder().decode(value).slice(0, 500).match(/^\s*\*\s*Build:\s*(\S+)/m)
    if (match) about.setNoisemaker(match[1])
}).catch(() => {})

about.open = about.show.bind(about)
about.close = about.hide.bind(about)

export { about as aboutModal }
