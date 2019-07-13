/**
 * The Crypto Info Bot
 *
 * @author Denis Efremov <efremov.a.denis@gmail.com>
 */
require('dotenv').load()

const axios = require('axios')
const winston = require('winston')
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

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'log/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'log/combined.log' }),
  ],
})

const formattedTime = (date) => date.toTimeString()
const formattedDate = (date) => date.toDateString()
const formattedDateTime = (date) => `${formattedDate(date)} ${formattedTime(date)}`

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
const pagination = (namespace, page, total) => ({
  reply_markup: {
    inline_keyboard: [[
      page !== 0
        ? { text: `< Prev ${PAGE_SIZE}`, callback_data: `/${namespace}/prev` }
        : { text: '----------', callback_data: '/noop' },
      {
        text: `${page * PAGE_SIZE} - ${(page + 1) * PAGE_SIZE} (${total})`,
        callback_data: '/noop',
      },
      page !== (total / PAGE_SIZE) - 1
        ? { text: `Next ${PAGE_SIZE} >`, callback_data: `/${namespace}/next` }
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

  if (limit) {
    url += `&limit=${limit}`
  }

  if (start) {
    url += `&start=${start}`
  }

  return axios.get(url)
}

/**
 * Gets the rate.
 *
 * @param {String} asset The asset
 * @return {Promise} The rate
 */
const getRate = (asset) => axios.get(`${API_URL}${asset}/?convert=RUB`)

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
const templateMd = ({
  name, symbol, price_usd, price_rub,
  percent_change_1h: hour,
  percent_change_24h: day,
  percent_change_7d: week,
}) => `${name} *(${symbol})* \`!${symbol.toLowerCase()}\`
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
 * @return {String}
 */
const smallTemplateMd = ({ name, symbol, price_usd, price_rub }) => `
${name} *(${symbol})* \`!${symbol.toLowerCase()}\`
\`\`\`
$ ${price_usd} | ₽ ${price_rub}
\`\`\``

/**
 * A currency message small template
 *
 * @param {Object} rate The rate object
 * @param {String} rate.symbol The symbol
 * @param {Number} rate.price_usd The price usd
 * @return {String}
 */
const lineTemplateMd = ({ symbol, price_usd }) => `
*(${symbol})* \`\`\`${price_usd}\`\`\``

/**
 * Map command listaners
 *
 * @param {Object[]} rates The rates
 * @return {Promise}
 */
const mapCommands = async (rates) => rates.reduce((acc, rate) => {
  const command = rate.symbol.toLowerCase()

  bot.hears(`!${command}`, async (ctx) => {
    let intervalId
    let response = await getRate(ctx.index[command]).catch((error) => {
      debug(error)
      clearInterval(intervalId)
    })
    let text = templateMd(response.data[0])
    let message = await ctx.replyWithMarkdown(
      `${text}\nUpdated: ${formattedTime(new Date()).slice(0, 8)}`
    ).catch((error) => {
      debug(error)
      clearInterval(intervalId)
    })

    message.text = text

    intervalId = setInterval(async () => {
      response = await getRate(ctx.index[command]).catch((error) => {
        debug(error)
        clearInterval(intervalId)
      })

      text = templateMd(response.data[0])

      if (text === message.text) {
        return
      }

      message = await ctx.tg.editMessageText(
        ctx.chat.id,
        message.message_id,
        undefined,
        `${text}\nUpdated: ${formattedTime(new Date()).slice(0, 8)}`,
        { parse_mode: 'Markdown' }
      ).catch((error) => {
        debug(error)
        clearInterval(intervalId)
      })
      message.text = text
    }, 5000)
  })

  acc[command] = rate.id

  return acc
}, {})

bot.use((ctx, next) => {
  logger.log({ level: 'info', message: ctx.message })
  debug(ctx.message)
  next()
})

/**
 * The rates command
 *
 * @param {TelegrafContext} ctx The bot's context
 */
bot.hears('!rates', async (ctx) => {
  ctx.session.ratesPage = ctx.session.ratesPage || 0

  const { data } = await getRates(
    ctx.session.ratesPage * PAGE_SIZE,
    (ctx.session.ratesPage * PAGE_SIZE) + PAGE_SIZE
  )

  await ctx.replyWithMarkdown(
    data.map(smallTemplateMd).join(''),
    pagination('rates', ctx.session.ratesPage, Object.keys(ctx.index).length),
  ).catch(debug)
})

/**
 * The time command
 *
 * @param {TelegrafContext} ctx The bot's context
 */
bot.hears('!time', async (ctx) => {
  const message = await ctx.replyWithMarkdown(formattedDateTime(new Date()))
    .catch(debug)

  const intervalId = setInterval(async () => {
    await ctx.tg.editMessageText(
      ctx.chat.id,
      message.message_id,
      undefined,
      formattedDateTime(new Date())
    ).catch((error) => {
      debug(error)
      clearInterval(intervalId)
    })
  }, 3000)
})

/**
 * The currencies list command
 *
 * @param {TelegrafContext} ctx The bot's context
 */
bot.hears('!list', async (ctx) => {
  const text = Object.keys(ctx.index)
    .map((key) => `\n${ctx.index[key]} \`!${key}\``)
    .join('')

  await ctx.replyWithMarkdown(text).catch(debug)
})

/**
 * The currencies list command
 *
 * @param {TelegrafContext} ctx The bot's context
 */
bot.hears('!pin', async (ctx) => {
  const text = Object.keys(ctx.index)
    .slice(0, 3)
    .map((key) => `${lineTemplateMd(ctx.index[key])}`)
    .join('')

  await ctx.replyWithMarkdown(text).catch(debug)
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
      ctx.session.ratesPage = current < (allKeys.length / PAGE_SIZE) - 1
        ? current + 1
        : (allKeys.length / PAGE_SIZE) - 1
      break
    default:
  }

  const { data } = await getRates(ctx.session.ratesPage * PAGE_SIZE, PAGE_SIZE)
    .catch(debug)

  await ctx.editMessageText(
    data.map(smallTemplateMd).join(''),
    {
      disable_web_page_preview: true,
      parse_mode: 'Markdown',
      ...pagination('rates', ctx.session.ratesPage, allKeys.length),
    }
  ).catch(debug)

  return ctx.answerCbQuery()
})

/**
 * Handles noop actions
 *
 * @param {TelegrafContext} ctx The bot's context
 */
bot.action(/^\/noop$/, async (ctx) => ctx.answerCbQuery())

/**
 * Handles the help command
 */
bot.command('help', async (ctx) => {
  const message = await ctx.replyWithMarkdown(`
*Usage:*

\`!list\` - List of all supported currencies without rates
\`!rates\` - Paginated list of all supported currencies with rates
\`!{TICKER}\` - Show rate of exact currency by its ticker
`)

  if (message) {
    setTimeout(() => {
      ctx.deleteMessage(message.message_id)
    }, 7000)
  }
})

// bot.command('leave', async (ctx) => {
//   ctx.tg.leaveChat(ctx.chat.id)
// })

// bot.on('inline_query', async (ctx) => {

// })

/**
 * Init the bot
 *
 * @param {TelegrafContext} ctx The bot's context
 */
const run = async (instance) => {
  const { data } = await getRates().catch(console.log)

  instance.context.index = await mapCommands(data)
  return instance
}

/**
 * Start the bot
 *
 * @param {Telegraf} instance The bot instance
 */
run(bot).then((instance) => {
  instance.startPolling()
})
