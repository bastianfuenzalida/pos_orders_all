# -*- coding: utf-8 -*-
# Part of BrowseInfo. See LICENSE file for full copyright and licensing details.

from odoo import fields, models, api, _
from odoo.exceptions import Warning
import random
from datetime import date, datetime

class pos_gift_coupon(models.Model):
    _name = 'pos.gift.coupon'
    
    
    def print_report_coupons(self):
        return self.env.ref('pos_orders_all.action_gift_coupons').report_action(self)


    @api.multi
    def existing_coupon(self,code):
    	coupon_code_record =self.search([('gift_coupen_code', '=',code)])
    	if len(coupon_code_record) == 1:
    		coupon_record = coupon_code_record[0]
    		return True
    	else:
    		return False
    	

    @api.multi
    def search_coupon(self, code):
        coupon_code_record = self.search([('gift_coupen_code', '=', code)])
        if coupon_code_record:
            return [coupon_code_record.id, coupon_code_record.amount, coupon_code_record.used, coupon_code_record.coupon_count, coupon_code_record.coupon_apply_times, coupon_code_record.expiry_date, coupon_code_record.partner_true,coupon_code_record.partner_id.id]


    @api.model
    def default_get(self, fields):
        pos_config_obj = self.env['pos.coupons.setting']
        if pos_config_obj.search_count([('active', '=',True)]) !=1 :
            raise Warning(_('Please configure gift coupons'))        

        
        rec = super(pos_gift_coupon, self).default_get(fields)
        config_obj = self.env['pos.coupons.setting']
        if config_obj.search_count([('active', '=',True)]) == 1:
            config_record = config_obj.search([('active', '=', True)])[0]
            if config_record:
                rec.update ({
								'amount': config_record.default_value ,
								})				
        return rec



    @api.one
    @api.constrains('amount')
    def _check_amount(self):
        confing_obj = self.env['pos.coupons.setting']
        if confing_obj.search_count([('active', '=',True)]) == 1:
            config_record = confing_obj.search([('active', '=', True)])[0]
            if self.amount < config_record.min_coupan_value or self.amount > config_record.max_coupan_value:
                raise Warning(_( "Amount is wrong"))




    @api.model
    def create(self, vals):
        pos_config_obj = self.env['pos.coupons.setting']
        if pos_config_obj.search_count([('active', '=',True)]) !=1 :
            raise Warning(_('Please configure gift coupons'))        
  
        else:
            code =(random.randrange(1111111111111,9999999999999))
            if pos_config_obj.search_count([('active', '=',True)]) == 1:
                config_record = pos_config_obj.search([('active', '=', True)])[0]
                if config_record.default_availability != -1:
                    if self.search_count([]) == config_record.default_availability:
                        raise Warning(_('You can only create %d coupons  ') %  config_record.default_availability )                         
                config_record = config_record.search([('active', '=', True)])[0]
                if config_record:
                    vals.update({'expiry_date':config_record.max_exp_date,
									'gift_coupen_code': str(code),
                                    
								 })
        return super(pos_gift_coupon,self).create(vals)       


		

		
    name  = fields.Char('Name')
    gift_coupen_code = fields.Char('Gift Coupon Code')
    user_id  =  fields.Many2one('res.users' ,'Created By',default  = lambda self: self.env.user)
    issue_date  =  fields.Datetime(default = datetime.now(), )
    expiry_date  = fields.Datetime('Expiry date')
    #validity =  fields. Integer('Validity(in days)')
    #total_available = fields.Integer('Total Available')
    partner_true = fields.Boolean('Allow for Specific Customer')
    partner_id  =  fields.Many2one('res.partner')
    order_ids = fields.One2many('pos.order','coupon_id')
    active = fields.Boolean('Active')
    amount  =  fields.Float('Coupon Amount')
    description  =  fields.Text('Note')
    used = fields.Boolean('Used')	
    coupon_apply_times = fields.Integer('Coupon Code Apply Limit', default=1)
    coupon_count = fields.Integer('coupon count', default=1)
	

	
	

