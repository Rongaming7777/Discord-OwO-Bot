const Discord = require('discord.js');
const Error = require('../../../../handler/errorHandler.js');
const teamUtil = require('./teamUtil.js');
const weaponUtil = require('./weaponUtil.js');
const animalUtil = require('./animalUtil.js');
const battleImageUtil = require('../battleImage.js');
const WeaponInterface = require('../WeaponInterface.js');
const imagegenAuth = require('../../../../../tokens/imagegen.json');

const attack = '👊🏼';
const weapon = '🗡';

var getBattle = exports.getBattle = async function(p){
	/* And our team */
	let sql = `SELECT pet_team_battle.pgid,tname,pos,animal.name,animal.nickname,animal.pid,animal.xp,user_weapon.uwid,user_weapon.wid,user_weapon.stat,user_weapon_passive.pcount,user_weapon_passive.wpid,user_weapon_passive.stat as pstat,cphp,cpwp,cehp,cewp
		FROM user 
			INNER JOIN pet_team ON user.uid = pet_team.uid
			INNER JOIN pet_team_battle ON pet_team.pgid = pet_team_battle.pgid
			INNER JOIN pet_team_animal ON pet_team_battle.pgid = pet_team_animal.pgid
			INNER JOIN animal ON pet_team_animal.pid = animal.pid
			LEFT JOIN user_weapon ON user_weapon.pid = pet_team_animal.pid
			LEFT JOIN user_weapon_passive ON user_weapon.uwid = user_weapon_passive.uwid 
		WHERE user.id = ${p.msg.author.id} 
			AND active = 1
		ORDER BY pos ASC;`;
	/* Query enemy team */
	sql += `SELECT pet_team_battle.pgid,tname,pos,animal.name,animal.nickname,animal.pid,animal.xp,user_weapon.uwid,user_weapon.wid,user_weapon.stat,user_weapon_passive.pcount,user_weapon_passive.wpid,user_weapon_passive.stat as pstat,cphp,cpwp,cehp,cewp
		FROM user 
			INNER JOIN pet_team ON user.uid = pet_team.uid
			INNER JOIN pet_team_battle ON pet_team.pgid = pet_team_battle.pgid
			INNER JOIN pet_team_animal ON pet_team_battle.epgid = pet_team_animal.pgid
			INNER JOIN animal ON pet_team_animal.pid = animal.pid
			LEFT JOIN user_weapon ON user_weapon.pid = pet_team_animal.pid
			LEFT JOIN user_weapon_passive ON user_weapon.uwid = user_weapon_passive.uwid 
		WHERE user.id = ${p.msg.author.id} 
			AND active = 1
		ORDER BY pos ASC;`;

	let result = await p.query(sql);

	/* Grab pgid */
	let pgid = result[0][0]?result[0][0].pgid:undefined;
	let epgid = result[1][0]?result[1][0].pgid:undefined;

	if(!pgid||!epgid) return undefined;

	/* Parse teams */
	let pTeam = teamUtil.parseTeam(p,result[0],result[0]);
	for(let i in pTeam) animalUtil.stats(pTeam[i]);
	let eTeam = teamUtil.parseTeam(p,result[1],result[1]);
	for(let i in eTeam) animalUtil.stats(eTeam[i]);

	/* Parse current hp/wp */
	parseSqlStats(pTeam,result[0][0].cphp,result[0][0].cpwp);
	parseSqlStats(eTeam,result[1][0].cehp,result[1][0].cewp);

	/* Combine result */
	let teams = {player:{pgid:pgid,name:result[0][0].tname,team:pTeam},enemy:{pgid:epgid,name:result[1][0].tname,team:eTeam}};

	return teams;
}

exports.initBattle = async function(p){
	/* Find random opponent */
	let sql = `SELECT COUNT(pgid) as count FROM pet_team`;
	let count = await p.query(sql);

	if(!count[0]) throw new Error("battleUtil sql is broken");

	count = Math.floor(Math.random()*count[0].count);

	/* Query random team */
	sql = `SELECT pet_team.pgid,tname,pos,name,nickname,pid,xp FROM pet_team LEFT JOIN (pet_team_animal NATURAL JOIN animal) ON pet_team.pgid = pet_team_animal.pgid WHERE pet_team.pgid = (
			SELECT pgid FROM pet_team LIMIT 1 OFFSET ${count}	
		) ORDER BY pos ASC;`;
	sql += `SELECT a.pid,a.uwid,a.wid,a.stat,b.pcount,b.wpid,b.stat as pstat,c.name,c.nickname 
		FROM 
			user_weapon a LEFT JOIN user_weapon_passive b ON a.uwid = b.uwid LEFT JOIN animal c ON a.pid = c.pid 
		WHERE 
			a.pid IN (
				SELECT pid FROM pet_team LEFT JOIN pet_team_animal ON pet_team.pgid = pet_team_animal.pgid WHERE pet_team.pgid = (SELECT pgid FROM pet_team LIMIT 1 OFFSET ${count})
			);`;
	/* And our team */
	sql += `SELECT pet_team.pgid,tname,pos,name,nickname,pid,xp FROM pet_team LEFT JOIN (pet_team_animal NATURAL JOIN animal) ON pet_team.pgid = pet_team_animal.pgid WHERE uid = (SELECT uid FROM user WHERE id = ${p.msg.author.id}) ORDER BY pos ASC;`;
	sql += `SELECT a.pid,a.uwid,a.wid,a.stat,b.pcount,b.wpid,b.stat as pstat,c.name,c.nickname FROM user_weapon a LEFT JOIN user_weapon_passive b ON a.uwid = b.uwid LEFT JOIN animal c ON a.pid = c.pid WHERE uid = (SELECT uid FROM user WHERE id = ${p.msg.author.id}) AND a.pid IN (SELECT pid FROM pet_team LEFT JOIN pet_team_animal ON pet_team.pgid = pet_team_animal.pgid WHERE uid = (SELECT uid FROM user WHERE id = ${p.msg.author.id}));`;

	let result = await p.query(sql);

	let pgid = result[0][0]?result[0][0].pgid:undefined;
	let epgid = result[2][0]?result[2][0].pgid:undefined;

	if(!pgid||!epgid) throw new Error("Could not grab pgid");

	/* Parse */
	let eTeam = teamUtil.parseTeam(p,result[0],result[1]);
	let pTeam = teamUtil.parseTeam(p,result[2],result[3]);

	/* Init stats for sql*/
	let cpstats = initSqlSaveStats(pTeam);
	let cestats = initSqlSaveStats(eTeam);
	
	/* Combine all to one obj */
	let teams = {player:{pgid:pgid,name:result[0][0].tname,team:pTeam},enemy:{pgid:epgid,name:result[2][0].tname,team:eTeam}};

	/* Added the team into team_battle table */
	sql = `INSERT IGNORE INTO pet_team_battle (pgid,epgid,cphp,cpwp,cehp,cewp,active) VALUES (
			${pgid},${epgid},
			'${cpstats.hp}','${cpstats.wp}',
			'${cestats.hp}','${cestats.wp}',
			1
		) ON DUPLICATE KEY UPDATE 
			epgid = ${epgid},
			cphp = '${cpstats.hp}', cpwp = '${cpstats.wp}',
			cehp = '${cpstats.hp}', cewp = '${cestats.wp}',
			active = 1,started = NOW();`;
	result = await p.query(sql);

	return teams;
}

/* Generates a display for the current battle */
var display = exports.display = async function(p,team){
	let image = await battleImageUtil.generateImage(team);
	/* TODO add team info+image in embed */
	let pTeam = "";
	for(var i=0;i<team.player.team.length;i++){
		let player = team.player.team[i];
		pTeam += player.animal.value;
		if(player.weapon){
			pTeam += " - "+player.weapon.rank.emoji+player.weapon.emoji;
			let passives = player.weapon.passives;
			for(var j in passives){
				pTeam += passives[j].emoji;
			}
		}else
			pTeam += " - *no weapon*";
		pTeam += "\n";
	}
	let eTeam = "";
	for(var i=0;i<team.enemy.team.length;i++){
		let enemy = team.enemy.team[i];
		eTeam += enemy.animal.value;
		if(enemy.weapon){
			eTeam += " - "+enemy.weapon.rank.emoji+enemy.weapon.emoji;
			let passives = enemy.weapon.passives;
			for(var j in passives){
				eTeam+= passives[j].emoji;
			}
		}else
			eTeam += " - *no weapon*";
		eTeam += "\n";

	}
	let embed = {
		"color":p.config.embed_color,
		"author":{
			"name":p.msg.author.username+" goes into battle!",
			"icon_url":p.msg.author.avatarURL
		},
		"fields":[
		{
			"name":team.player.name,
			"value":pTeam,
			"inline":true
		},{
			"name":team.enemy.name,
			"value":eTeam,
			"inline":true
		}
		],
		"image":{
			"url":imagegenAuth.imageGenUrl+"/battleimage/uuid/"+image
		}
	}
	//return {file:image,embed};
	return {embed}
}

/* Creates a reaction collector and executes the turn */
var reactionCollector = exports.reactionCollector = async function(p,msg,battle){
	/* Add initial reactions */
	await msg.react(attack);
	await msg.react(weapon);
	let team = battle.player.team;
	var current = 0;
	if(!team[current]) return;
	var emoji  = team[current].animal.uni?team[current].animal.uni:await p.client.emojis.get(p.global.parseID(team[current].animal.value));
	var emojiReaction = await msg.react(emoji);

	/* Construct reaction collector */
	var filter = (reaction,user) => (reaction.emoji.name===attack||reaction.emoji.name===weapon)&&user.id===p.msg.author.id;
	var collector = msg.createReactionCollector(filter,{time:60000});
	var action = {};
	collector.on('collect', async function(r){
		/* Save the animal's action */
		if(r.emoji.name===attack) action[current] = attack;
		else action[current] = weapon;

		current++;
		emojiReaction.remove();
		/* Check if we need to gather more actions */
		if(!team[current]){
			/* If not, execute the actions */
			collector.stop();
			try{
				await executeBattle(p,msg,action);
			}catch(err){
				console.error(err);
			}
		}else{
			/* Else, gather more actions */
			emoji  = team[current].animal.uni?team[current].animal.uni:await p.client.emojis.get(p.global.parseID(team[current].animal.value));
			emojiReaction = await msg.react(emoji);
		}
	});

	collector.on('end',collected => {});
}

/* Executes a whole battle sequence */
async function executeBattle(p,msg,action){
	/* Update current battle */
	let battle = await getBattle(p);
	if(!battle){
		await msg.edit("⚠ **|** This battle is inactive!");
		return;
	}

	/* Execute player actions */
	executeTurn(battle.player.team,battle.enemy.team,action);

	/* Decide enemy actions */
	action = [attack,attack,attack];
	/* Execute enemy actions */
	executeTurn(battle.enemy.team,battle.player.team,action);

	/* Save current state */
	let cpstats = initSqlSaveStats(battle.player.team);
	let cestats = initSqlSaveStats(battle.enemy.team);
	let ocpstats = initSqlSaveStats(battle.player.team,2);
	let ocestats = initSqlSaveStats(battle.enemy.team,2);
	sql = `UPDATE pet_team_battle SET
			cphp = '${cpstats.hp}', cpwp = '${cpstats.wp}',
			cehp = '${cestats.hp}', cewp = '${cestats.wp}'
		WHERE 
			pgid = ${battle.player.pgid} AND
			epgid = ${battle.enemy.pgid} AND
			active = 1 AND
			cphp = '${ocpstats.hp}' AND cpwp = '${ocpstats.wp}' AND
			cehp = '${ocestats.hp}' AND cewp = '${ocestats.wp}';
		`;
	let result = await p.query(sql);

	let embed = await display(p,battle);
	await msg.edit(embed);
	await reactionCollector(p,msg,battle);
}

/* Calculates a turn for a team */
function executeTurn(team,enemy,action){
	for(var i in team){
		let animal= team[i];
		/* Check if animal has weapon */
		if(animal.weapon){
			if(action[i]==weapon)
				animal.weapon.attackWeapon(animal,team,enemy);
			else
				animal.weapon.attackPhysical(animal,team,enemy);
		}else{
			WeaponInterface.basicAttack(animal,team,enemy);
		}
	}
}

/* ==================== Extra Helpers ================== */

/* Creates string to save in sql */
function initSqlSaveStats(team,offset=0){
	hp = "";
	wp = "";
	for(let i in team){
		if(!team[i].stats) animalUtil.stats(team[i]);
		hp += team[i].stats.hp[offset]+",";
		wp += team[i].stats.wp[offset]+",";
	}
	return {hp:hp.slice(0,-1),wp:wp.slice(0,-1)};
}

/* Parses string from sql */
function parseSqlStats(team,hp,wp){
	hp = hp.split(',');
	wp = wp.split(',');
	if(team.length != (hp.length+wp.length)/2)
		throw new Error("Hp/Wp Stats does not match");
	
	for(let i=0;i<team.length;i++){
		team[i].stats.hp[0] = parseInt(hp[i]);
		team[i].stats.hp[2] = parseInt(hp[i]);
		team[i].stats.wp[0] = parseInt(wp[i]);
		team[i].stats.wp[2] = parseInt(wp[i]);
	}
}
