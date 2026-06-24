const { SlashCommandBuilder } = require('discord.js');

// Quick real facts, delivered flat. The data is always real — fetched
// (weather) or computed locally (convert) — and Johnny only ever voices the
// wrapper around it. Per the house rule, he never invents the numbers.

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('weather')
      .setDescription("Johnny tells you the weather. Like it's a chore.")
      .addStringOption(o => o.setName('place').setDescription('City or place').setRequired(true)),
    async execute(interaction, ctx) {
      const place = interaction.options.getString('place');
      const w = await ctx.weather.getWeather(place);
      if (!w) {
        return interaction.editReply(`couldn't find "${place}" on the map. spell it like a place that exists.`);
      }

      const dataLine = `${w.label}: ${w.temp}°C, feels like ${w.feels}°C, ${w.desc}, wind ${w.wind} km/h.`;
      const quip = await ctx.askJohnny(`The weather is: ${dataLine} Give ONE flat, deadpan reaction line. Don't repeat the numbers.`, {
        maxTokens: 60,
      });
      await interaction.editReply(`${dataLine}\n${quip}`);
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('convert')
      .setDescription('Johnny converts units. Correctly, unfortunately.')
      .addNumberOption(o => o.setName('value').setDescription('The number').setRequired(true))
      .addStringOption(o => o.setName('from').setDescription('e.g. miles').setRequired(true))
      .addStringOption(o => o.setName('to').setDescription('e.g. km').setRequired(true)),
    async execute(interaction, ctx) {
      const value = interaction.options.getNumber('value');
      const from = interaction.options.getString('from');
      const to = interaction.options.getString('to');

      const res = ctx.convert.convert(value, from, to);
      if (!res.ok) {
        return interaction.editReply(`i don't do "${from}" to "${to}". try real units from the same family.`);
      }

      const out = ctx.convert.round(res.value);
      const quip = await ctx.askJohnny(`Converted ${value} ${from} to ${out} ${to}. Give ONE flat throwaway line. Don't restate the math.`, {
        maxTokens: 50,
      });
      await interaction.editReply(`${value} ${from} = ${out} ${to}\n${quip}`);
    },
  },
];
