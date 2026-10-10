(function () {
  'use strict'
  if (window.sakuraActivityCalendars) { window.sakuraActivityCalendars.refresh(); return }
  var types = ['article', 'fitness', 'leetcode']
  var names = { article: '文章日历', fitness: '健身日历', leetcode: '力扣日历' }
  var units = { article: '篇文章', fitness: '分钟训练', leetcode: '次提交' }
  var state = { data: {}, promise: null, fetched: 0, selected: 'article' }
  try { if (types.indexOf(localStorage.getItem('activity-calendar')) >= 0) state.selected = localStorage.getItem('activity-calendar') } catch (e) {}
  var dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
  function dateKey (date) { return dateFormat.format(date) }
  function roots () { return document.querySelectorAll('[data-activity-calendars]') }
  function element (tag, className, text) {
    var el = document.createElement(tag)
    if (className) el.className = className
    if (text !== undefined) el.textContent = text
    return el
  }
  function dayInfo (type, date) {
    var source = state.data[type]
    if (!source) return { value: 0, pending: true }
    var pending = type === 'leetcode' && (source.coverageYears.indexOf(Number(date.slice(0, 4))) < 0 || date > dateKey(new Date(source.lastSuccessfulSync)))
    return { value: source.days[date] || 0, pending: pending }
  }
  function status (type) {
    var source = state.data[type]
    if (!source) return '数据暂未加载，可稍后重试'
    if (type === 'article') return '按文章发布日期统计'
    if (type === 'fitness') return '修改记录文件后自动更新'
    return '同步于 ' + new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(source.lastSuccessfulSync)) + ' · 提交次数'
  }
  function select (type) {
    state.selected = type
    try { localStorage.setItem('activity-calendar', type) } catch (e) {}
    Array.prototype.forEach.call(roots(), arrange)
  }
  function arrange (root) {
    types.forEach(function (type, i) {
      var rank = (i - types.indexOf(state.selected) + 3) % 3
      var card = root.querySelector('[data-type="' + type + '"]')
      card.dataset.rank = rank
      card.setAttribute('aria-hidden', rank ? 'true' : 'false')
      card.inert = rank !== 0
      var tab = root.querySelector('[data-select="' + type + '"]')
      tab.setAttribute('aria-pressed', type === state.selected ? 'true' : 'false')
    })
    root.querySelector('.activity-status').textContent = status(state.selected)
    var action = root.querySelector('.activity-action')
    action.hidden = state.selected === 'article'
    action.textContent = state.selected === 'fitness' ? '编辑健身记录 ↗' : '去力扣刷题 ↗'
    action.href = state.selected === 'fitness'
      ? 'https://github.com/sdracula/sdracula.github.io/edit/main/data/fitness.md'
      : 'https://leetcode.cn/u/sdracula/'
    root.querySelector('.activity-detail').textContent = '点击日期格查看当天记录'
  }
  function build (root) {
    root.innerHTML = ''
    var controls = element('div', 'activity-controls')
    controls.setAttribute('aria-label', '选择日历')
    types.forEach(function (type) {
      var button = element('button', '', names[type].replace('日历', ''))
      button.type = 'button'; button.dataset.select = type
      controls.appendChild(button)
    })
    root.appendChild(controls)
    var stack = element('div', 'activity-stack')
    var today = new Date(dateKey(new Date()) + 'T00:00:00+08:00')
    var start = new Date(today.getTime() - 364 * 86400000)
    types.forEach(function (type) {
      var card = element('section', 'activity-card activity-' + type)
      card.dataset.type = type
      card.setAttribute('aria-label', names[type])
      card.appendChild(element('h3', 'activity-heading', names[type]))
      var content = element('div', 'activity-content')
      var summary = element('div', 'activity-summary')
      summary.appendChild(element('span', '', dateKey(start) + ' — ' + dateKey(today)))
      var total = 0; var active = 0
      var months = element('div', 'activity-months')
      var grid = element('div', 'activity-grid')
      grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', names[type] + '最近365天')
      var weekday = new Date(start.getTime() + 8 * 3600000).getUTCDay()
      for (var pad = 0; pad < weekday; pad++) grid.appendChild(element('span', 'activity-spacer'))
      var lastMonth = ''
      for (var i = 0; i < 365; i++) {
        var day = new Date(start.getTime() + i * 86400000)
        var key = dateKey(day); var info = dayInfo(type, key)
        total += info.value; if (info.value > 0) active++
        var cell = element('button', 'activity-cell')
        cell.type = 'button'; cell.dataset.date = key; cell.dataset.calendar = type
        cell.tabIndex = i === 364 ? 0 : -1
        cell.dataset.level = info.pending ? 'pending' : Math.min(4, type === 'fitness' ? Math.ceil(info.value / 20) : info.value)
        cell.setAttribute('aria-label', key + '：' + (info.pending ? '待同步' : info.value + ' ' + units[type]))
        cell.title = cell.getAttribute('aria-label')
        grid.appendChild(cell)
        if (key.slice(0, 7) !== lastMonth) {
          lastMonth = key.slice(0, 7)
          var month = element('span', '', Number(key.slice(5, 7)) + '月')
          month.style.left = ((weekday + i) / 371 * 100) + '%'
          if (i > 345) month.className = 'activity-month-end'
          months.appendChild(month)
        }
      }
      summary.appendChild(element('span', '', active + ' 个活跃日 · ' + total + ' ' + units[type]))
      content.appendChild(summary); content.appendChild(months)
      var plot = element('div', 'activity-plot')
      var labels = element('div', 'activity-weekdays')
      labels.setAttribute('aria-hidden', 'true')
      ;['日', '', '二', '', '四', '', '六'].forEach(function (label) { labels.appendChild(element('span', '', label)) })
      plot.appendChild(labels); plot.appendChild(grid); content.appendChild(plot)
      var legend = element('div', 'activity-legend')
      legend.appendChild(element('span', '', type === 'fitness' ? '按训练时长' : type === 'leetcode' ? '按提交次数（含重复提交）' : '按发表篇数'))
      var levels = element('span', 'activity-levels', '少 ')
      for (var level = 0; level <= 4; level++) { var swatch = element('span', 'activity-swatch'); swatch.dataset.level = level; levels.appendChild(swatch) }
      levels.appendChild(document.createTextNode(' 多')); legend.appendChild(levels); content.appendChild(legend)
      card.appendChild(content); stack.appendChild(card)
    })
    root.appendChild(stack)
    var footer = element('div', 'activity-footer')
    var prev = element('button', '', '←'); prev.type = 'button'; prev.dataset.direction = '-1'; prev.setAttribute('aria-label', '上一张日历')
    var next = element('button', '', '→'); next.type = 'button'; next.dataset.direction = '1'; next.setAttribute('aria-label', '下一张日历')
    footer.appendChild(prev); footer.appendChild(element('span', 'activity-status')); footer.appendChild(next)
    var action = element('a', 'activity-action'); action.target = '_blank'; action.rel = 'noopener noreferrer'; footer.appendChild(action)
    root.appendChild(footer)
    var detail = element('p', 'activity-detail'); detail.setAttribute('aria-live', 'polite'); root.appendChild(detail)
    arrange(root)
    if (!root.activityBound) {
      root.activityBound = true
      root.addEventListener('click', function (event) {
        var target = event.target.closest('button')
        if (!target) return
        if (target.dataset.select) select(target.dataset.select)
        if (target.dataset.direction) select(types[(types.indexOf(state.selected) + Number(target.dataset.direction) + 3) % 3])
        if (target.dataset.date) {
          var info = dayInfo(target.dataset.calendar, target.dataset.date)
          var text = target.dataset.date + ' · ' + (info.pending ? '尚未同步，请等待下一次更新' : info.value + ' ' + units[target.dataset.calendar])
          if (target.dataset.calendar === 'fitness' && state.data.fitness) {
            var entries = state.data.fitness.entries.filter(function (entry) { return entry.date === target.dataset.date })
            if (entries.length) text += ' · ' + entries.map(function (entry) { return entry.activity + ' ' + entry.minutes + ' 分钟' + (entry.note ? '（' + entry.note + '）' : '') }).join('、')
          }
          root.querySelector('.activity-detail').textContent = text
        }
      })
      root.addEventListener('keydown', function (event) {
        if (!/^Arrow(Left|Right|Up|Down)$/.test(event.key)) return
        var target = event.target
        if (target.dataset.date) {
          var cells = Array.prototype.slice.call(target.parentNode.querySelectorAll('button'))
          var offset = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[event.key]
          var index = Math.max(0, Math.min(364, cells.indexOf(target) + offset))
          cells.forEach(function (cell) { cell.tabIndex = -1 }); cells[index].tabIndex = 0; cells[index].focus()
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') select(types[(types.indexOf(state.selected) + (event.key === 'ArrowRight' ? 1 : 2)) % 3])
        event.preventDefault()
      })
    }
    root.activityDay = dateKey(today)
  }
  function renderAll () { Array.prototype.forEach.call(roots(), build) }
  function refresh () {
    if (!roots().length) return
    Array.prototype.forEach.call(roots(), function (root) { if (!root.querySelector('.activity-stack') || root.activityDay !== dateKey(new Date())) build(root) })
    if (state.promise || Date.now() - state.fetched < 60000) return
    state.promise = Promise.all(types.map(function (type) {
      return fetch('/data/' + type + '.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('Calendar data unavailable'); return r.json() })
        .then(function (data) { if (!data.days || (type === 'leetcode' && !Array.isArray(data.coverageYears))) throw new Error('Invalid calendar data'); state.data[type] = data })
        .catch(function () {})
    })).then(function () { state.fetched = Date.now(); state.promise = null; renderAll() })
  }
  function schedule () { window.requestAnimationFrame(refresh) }
  window.sakuraActivityCalendars = { refresh: refresh }
  if (!document.getElementById('activity-calendar-style')) {
    var style = element('link'); style.id = 'activity-calendar-style'; style.rel = 'stylesheet'; style.href = '/css/activity-calendars.css?v=20261010'; document.head.appendChild(style)
  }
  if (window.jQuery) window.jQuery(document).on('pjax:end.activityCalendars', schedule)
  window.addEventListener('pageshow', schedule); window.addEventListener('popstate', schedule)
  document.addEventListener('visibilitychange', function () { if (!document.hidden) schedule() })
  new MutationObserver(function (records) {
    if (records.some(function (record) { return Array.prototype.some.call(record.addedNodes, function (node) { return node.nodeType === 1 && (node.hasAttribute('data-activity-calendars') || node.querySelector('[data-activity-calendars]')) }) })) schedule()
  }).observe(document.body, { childList: true, subtree: true })
  window.setInterval(schedule, 60000)
  schedule()
})()
