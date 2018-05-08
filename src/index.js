/**
 * The Crypto Info Bot
 *
 * @author Denis Efremov <efremov.a.denis@gmail.com>
 *
 *
 *
 *
 */
require('dotenv').load()

const formattedTime = (date) => date.toTimeString()

const formattedDate = (date) => date.toDateString()

const formattedDateTime = (date) => `${formattedDate(date)} ${formattedTime(date)}`

const axios = require('axios')
const { inspect } = require('util')
const Telegraf = require('telegraf')


const { session } = Telegraf
const {
  API_URL,
  BOT_TOKEN,
  BOT_USERNAME,
  PAGE_SIZE,
  FIXED_LENGTH,
} = process.env

/**
 * Debug helper
 *
 * @param {Mixed} data The data
 * @return {Mixed}
 */
const debug = (data) => console.log(inspect(data, {
  showHidden: true,
  colors: true,
  depth: 10,
}))

/**
 * Create a new bot instance
 *
 * @type {Telegraf}
 */
const bot = new Telegraf(BOT_TOKEN, { username: BOT_USERNAME })

bot.use(session())

/**
 * Render pagination buttons
 *
 * @param {String} ns The namespace
 * @param {Number} page The page
 * @param {Number} total The total
 * @return {Object} Message parameters
 */
const pagination = (ns, page, total) => ({
  reply_markup: {
    inline_keyboard: [[
      page !== 0
        ? { text: `< Prev ${PAGE_SIZE}`, callback_data: `/${ns}/prev` }
        : { text: '----------', callback_data: '/noop' },
      {
        text: `${page * PAGE_SIZE} - ${(page + 1) * PAGE_SIZE} (${total})`,
        callback_data: '/noop',
      },
      page !== (total / PAGE_SIZE) - 1
        ? { text: `Next ${PAGE_SIZE} >`, callback_data: `/${ns}/next` }
        : { text: '----------', callback_data: '/noop' },
    ]],
  },
})

/**
 * Gets the rates.
 *
 * @param {Number} start The start
 * @param {Number} limit The limit
 * @return {Promise} The rates
 */
const getRates = (start, limit) => {
  let url = `${API_URL}?convert=RUB`

  if (limit) url += `&limit=${limit}`
  if (start) url += `&start=${start}`

  return axios.get(url)
}

/**
 * Gets the rate.
 *
 * @param {String} route The route
 * @return {Promise} The rate
 */
const getRate = (route) => axios.get(`${API_URL}${route}/?convert=RUB`)

/**
 * A currency message template
 *
 * @param {Object} rate The rate object
 * @param {String} rate.name The name
 * @param {String} rate.symbol The symbol
 * @param {Number} rate.price_usd The price usd
 * @param {Number} rate.price_rub The price rub
 * @param {Number} rate.percent_change_1h:hour The percent change 1 h hour
 * @param {Number} rate.percent_change_24h:day The percent change 24 h day
 * @param {Number} rate.percent_change_7d:week The percent change 7 d week
 * @return {String}
 */
const template = ({ name, symbol, price_usd, price_rub,
  percent_change_1h: hour,
  percent_change_24h: day,
  percent_change_7d: week,
}) => `${name} *(${symbol})* /${symbol.toLowerCase()}
\`\`\`
==================
$ ${price_usd}
₽ ${price_rub}
==================
${hour > 0 ? '+' : ''}${parseFloat(hour).toFixed(FIXED_LENGTH)}% / 1h
${day > 0 ? '+' : ''}${parseFloat(day).toFixed(FIXED_LENGTH)}% / 24h
${week > 0 ? '+' : ''}${parseFloat(week).toFixed(FIXED_LENGTH)}% / 7d
\`\`\``

/**
 * A currency message small template
 *
 * @param {Object} rate The rate object
 * @param {String} rate.name The name
 * @param {String} rate.symbol The symbol
 * @param {Number} rate.price_usd The price usd
 * @param {Number} rate.price_rub The price rub
 * @param {Number} rate.percent_change_1h:hour The percent change 1 h hour
 * @param {Number} rate.percent_change_24h:day The percent change 24 h day
 * @param {Number} rate.percent_change_7d:week The percent change 7 d week
 * @return {String}
 */
const smallTemplate = ({ name, symbol, price_usd, price_rub }) => `
${name} *(${symbol})* /${symbol.toLowerCase()}
\`\`\`
$ ${price_usd} | ₽ ${price_rub}
\`\`\``


/**
 * Map command listaners
 *
 * @param {Object[]} rates The rates
 * @return {Promise}
 */
const mapCommands = async (rates) => rates.reduce((acc, rate) => {
  const command = rate.symbol.toLowerCase()

  bot.command(command, async (ctx) => {
    let text
    let message
    let response

    try {
      response = await getRate(ctx.index[command])
    }
    catch (error) {
      debug(error)
      clearInterval(intervalId)
    }

    text = template(response.data[0])

    try {
      message = await ctx.replyWithMarkdown(`${text}\nUpdated: ${formattedTime(new Date()).slice(0, 8)}`)
      message.text = text
    }
    catch (error) {
      debug(error)
      clearInterval(intervalId)
    }

    const intervalId = setInterval(async () => {
      try {
        response = await getRate(ctx.index[command])
      }
      catch (error) {
        debug(error)
        clearInterval(intervalId)
      }

      text = template(response.data[0])

      if (text === message.text) {
        return
      }

      try {
        message = await ctx.tg.editMessageText(
          ctx.chat.id,
          message.message_id,
          undefined,
          `${text}\nUpdated: ${formattedTime(new Date()).slice(0, 8)}`,
          { parse_mode: 'Markdown' }
        )
        message.text = text
      }
      catch (error) {
        debug(error)
        clearInterval(intervalId)
      }
    }, 5000)
  })

  acc[command] = rate.id
  return acc
}, {})

/**
 * Init the bot
 *
 * @param {TelegrafContext} ctx The bot's context
 */
getRates().then(async ({ data }) => {
  bot.context.index = await mapCommands(data)
})

/**
 * The rates command
 *
 * @param {TelegrafContext} ctx The bot's context
 */
bot.command('rates', async (ctx) => {
  ctx.session.ratesPage = ctx.session.ratesPage || 0

  const { data } = await getRates(
    ctx.session.ratesPage * PAGE_SIZE,
    (ctx.session.ratesPage * PAGE_SIZE) + PAGE_SIZE
  )

  try {
    await ctx.replyWithMarkdown(
      data.map(smallTemplate).join(''),
      pagination('rates', ctx.session.ratesPage, Object.keys(ctx.index).length),
    )
  }
  catch (error) {
    debug(error)
  }
})

/**
 * The time command
 *
 * @param {TelegrafContext} ctx The bot's context
 */
bot.command('time', async (ctx) => {
  let message
  let date = new Date()

  try {
    message = await ctx.replyWithMarkdown(formattedDate(date))
  }
  catch (error) {
    debug(error)
  }

  const intervalId = setInterval(async () => {
    date = new Date()

    try {
      await ctx.tg.editMessageText(
        ctx.chat.id,
        message.message_id,
        undefined,
        formattedDate(date)
      )
    }
    catch (error) {
      debug(error)
      clearInterval(intervalId)
    }
  }, 5000)
})

/**
 * The currencies list command
 *
 * @param {TelegrafContext} ctx The bot's context
 */
bot.command('list', async (ctx) => {
  try {
    await ctx.replyWithMarkdown(Object.keys(ctx.index).map((key) => `
${ctx.index[key]} /${key}`).join(''))
  }
  catch (error) {
    debug(error)
  }
})

/**
 * Change page action
 *
 * @param {TelegrafContext} ctx The bot's context
 */
bot.action(/^\/rates\/(\w+)$/, async (ctx) => {
  const current = ctx.session.ratesPage || 0
  const allKeys = Object.keys(ctx.index)

  switch (ctx.match[1]) {
    case 'prev':
      ctx.session.ratesPage = current > 0
        ? current - 1
        : 0
      break
    case 'next':
      // eslint-disable-next-line max-len
      ctx.session.ratesPage = current < (allKeys.length / PAGE_SIZE) - 1
        ? current + 1
        : (allKeys.length / PAGE_SIZE) - 1
      break
    default:
  }

  const { data } = await getRates(ctx.session.ratesPage * PAGE_SIZE, PAGE_SIZE)

  try {
    await ctx.editMessageText(
      data.map(smallTemplate).join(''),
      {
        disable_web_page_preview: true,
        parse_mode: 'Markdown',
        ...pagination('rates', ctx.session.ratesPage, allKeys.length),
      }
    )
  }
  catch (error) {
    debug(error)
  }

  return ctx.answerCbQuery()
})

bot.startPolling()
