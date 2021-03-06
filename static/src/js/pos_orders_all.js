odoo.define('bi_pos_reorder.pos', function(require) {
	"use strict";

	var models = require('point_of_sale.models');
	var screens = require('point_of_sale.screens');
	var core = require('web.core');
	var gui = require('point_of_sale.gui');
	var popups = require('point_of_sale.popups');
	var Model = require('web.DataModel');
	var QWeb = core.qweb;
	var PosDB = require('point_of_sale.DB');
	
	var utils = require('web.utils');
	var round_pr = utils.round_precision;

	var _t = core._t;
	
	models.load_models({
		model: 'stock.location',
		fields: [],
		//ids:    function(self){ return [self.config.stock_location_id[0]]; },

		loaded: function(self, locations){
			var i;
			self.locations = locations[0];
			
			if (self.config.show_stock_location == 'specific')
			{

				// associate the Locations with their quants.
				var ilen = locations.length;
				for(i = 0; i < ilen; i++){
					if(locations[i].id === self.config.stock_location_id[0]){
						var ayaz = locations[i];
						self.locations = ayaz;
					}
				}
			}

		},
	});
	
	
	var _super_order = models.Order.prototype;
	models.Order = models.Order.extend({
		export_as_JSON: function() {
			var json = _super_order.export_as_JSON.apply(this,arguments);
			json.coupon_id = this.coupon_id;
			return json;
		},
		
		
		// Total Items Count in exports.Orderline = Backbone.Model.extend ...
		get_total_items: function() {
		   var utils = require('web.utils');
		   var round_pr = utils.round_precision;
			
			 return round_pr(this.orderlines.reduce((function(sum, orderLine) {
			return sum + orderLine.quantity;

		}), 0), this.pos.currency.rounding);
	sum
		},


		 get_fixed_discount: function() {
			var total=0.0;
			var i;
			for(i=0;i<this.orderlines.models.length;i++) 
			{
				total = total + Math.min(Math.max(parseFloat(this.orderlines.models[i].discount * this.orderlines.models[i].quantity) || 0, 0),100);
			}
			return total
		},
				
		
	});

	// exports.Orderline = Backbone.Model.extend ...
   var OrderlineSuper = models.Orderline;
	models.Orderline = models.Orderline.extend({
	

		set_discount: function(discount){
			if (this.pos.config.discount_type == 'percentage')
			{
				var disc = Math.min(Math.max(parseFloat(discount) || 0, 0),100);
			}
			else if (this.pos.config.discount_type == 'fixed')
			{
				var disc = discount;
			}
			this.discount = disc;
			this.discountStr = '' + disc;
			this.trigger('change',this);
		},
	

		get_base_price:    function(){
			var rounding = this.pos.currency.rounding;
			if (this.pos.config.discount_type == 'percentage')
			{
				return round_pr(this.get_unit_price() * this.get_quantity() * (1 - this.get_discount()/100), rounding);
			}
			else if (this.pos.config.discount_type == 'fixed')
			{
				return round_pr((this.get_unit_price()- this.get_discount())* this.get_quantity(), rounding);   
			}
		},
		
		get_all_prices: function(){
			
			if (this.pos.config.discount_type == 'percentage')
			{
				var price_unit = this.get_unit_price() * (1.0 - (this.get_discount() / 100.0));
			}
			else if (this.pos.config.discount_type == 'fixed')
			{
				// var price_unit = this.get_unit_price() - this.get_discount();
				var price_unit = this.get_base_price()/this.get_quantity();     
			}   
			var taxtotal = 0;

			var product =  this.get_product();
			var taxes_ids = product.taxes_id;
			var taxes =  this.pos.taxes;
			var taxdetail = {};
			var product_taxes = [];

			_(taxes_ids).each(function(el){
				product_taxes.push(_.detect(taxes, function(t){
					return t.id === el;
				}));
			});

			var all_taxes = this.compute_all(product_taxes, price_unit, this.get_quantity(), this.pos.currency.rounding);
			_(all_taxes.taxes).each(function(tax) {
				taxtotal += tax.amount;
				taxdetail[tax.id] = tax.amount;
			});

			return {
				"priceWithTax": all_taxes.total_included,
				"priceWithoutTax": all_taxes.total_excluded,
				"tax": taxtotal,
				"taxDetails": taxdetail,
			};
		},
		
	});
	// End Orderline start
	

	var _super_posmodel = models.PosModel.prototype;
	  models.PosModel = models.PosModel.extend({
		
		initialize: function (session, attributes) {
			var product_model = _.find(this.models, function(model){ return model.model === 'product.product'; });
			product_model.fields.push('available_quantity','qty_available','virtual_available','incoming_qty','outgoing_qty','type');

			return _super_posmodel.initialize.call(this, session, attributes);
		},
		
		//================================================ orders list start =================================================================
		
		_save_to_server: function(orders, options) {
			var self = this;
			return _super_posmodel._save_to_server.call(this, orders, options).then(function(new_orders) {
				if (new_orders != null) {
					new_orders.forEach(function(order) {
						if (order) {
							new Model('pos.order').call('return_new_order', [order]).then(function(output) {
								self.db.all_orders_list.unshift(output);
								self.db.get_orders_by_id[order.id] = order;
							});
							
							//######################################################################################
							new Model('pos.order').call('return_new_order_line', [order]).then(function(output1) {
								for(var ln=0; ln < output1.length; ln++){
									self.db.all_orders_line_list.unshift(output1[ln]);
								}
								
								//self.db.get_orders_by_id[order.id] = order;
							});
							//######################################################################################
						   
						   
						   // self.db.all_orders_list.unshift(orders[0]['data']);
							//self.db.get_orders_by_id[order.id] = order;
							
							
						}
					});
				}
				return new_orders;
			});
		},
		
		load_new_orders: function(){
			var self = this;
			var def  = new $.Deferred();
			var fields = _.find(this.models,function(model){ return model.model === 'pos.order'; }).fields;
			
			new Model('pos.order')
				.query(fields)
				.all({'timeout':3000, 'shadow': true})
				.then(function(orders){
					if (self.db.orders) {   // check if the products we got were real updates
						def.resolve();
					} else {
						def.reject();
					}
				}, function(err,event){ event.preventDefault(); def.reject(); });
			return def;
		},
		
		//================================================ orders list end =================================================================
		
		
		
		//bi_pos_stock{
		load_product_qty:function(product){
			
			var product_qty_final = $("[data-product-id='"+product.id+"'] #stockqty");
			product_qty_final.html(product.qty_available)

			var product_qty_avail = $("[data-product-id='"+product.id+"'] #availqty");
			product_qty_avail.html(product.available_quantity-product_qty_final);
			
		},

		push_order: function(order, opts){
			var self = this;
			var pushed = _super_posmodel.push_order.call(this, order, opts);
			var client = order && order.get_client();
			
			if (order){
				//##############################
				if (this.config.pos_display_stock === true && this.config.pos_stock_type == 'onhand' || this.config.pos_stock_type == 'available'){
				order.orderlines.each(function(line){
					var product = line.get_product();
					product.qty_available -= line.get_quantity();
					self.load_product_qty(product);
				})
				}
			}
			return pushed;
		}//bi_pos_stock
	});
	
	
	
// Load Models here...

	models.load_models({
		model:  'sale.order',
		fields: ['name','partner_id','confirmation_date','user_id','amount_untaxed',
				 'order_line','session_id','amount_tax','amount_total','company_id','date_order'],
		domain: null,
		loaded: function(self,order){
			var i=0;
			self.all_sale_orders_list = order;
			self.get_orders_by_id = {};
			order.forEach(function(orders) {
				self.get_orders_by_id[orders.id] = orders;
			});
		},
	});

	models.load_models({
		model: 'sale.order.line',
		fields: ['order_id', 'product_id', 'discount', 'product_uom_qty', 'price_unit','price_subtotal'],
		domain: function(self) {
			var order_lines = []
			var orders = self.all_sale_orders_list;
			for (var i = 0; i < orders.length; i++) {
				order_lines = order_lines.concat(orders[i]['order_line']);
			}
			return [
				['id', 'in', order_lines]
			];
		},
		loaded: function(self, sale_order_line) {
			self.all_sale_orders_line_list = sale_order_line;
			self.get_lines_by_id = {};
			sale_order_line.forEach(function(line) {
				self.get_lines_by_id[line.id] = line;
			});

			self.sale_order_line = sale_order_line;
		},
	});

	models.load_models({
		model: 'pos.order',
		fields: ['name', 'id', 'date_order','discount_type', 'partner_id', 'pos_reference', 'lines', 'amount_total','amount_tax','session_id', 'state', 'company_id','coupon_id','barcode'],
		domain: function(self){ 
			var current = self.pos_session.id
			// console.log("current=======================",current)
			if (self.config.pos_session_limit == 'all')
			{
				return [['state', 'not in', ['draft', 'cancel']]]; 
			}
			if (self.config.pos_session_limit == 'last3')
			{
				return [['state', 'not in', ['draft', 'cancel']],['session_id', 'in',[current,current-1,current-2,current-3]]]; 
			}
			if (self.config.pos_session_limit == 'last5')
			{
				return [['state', 'not in', ['draft', 'cancel']],['session_id', 'in',[current,current-1,current-2,current-3,current-4,current-5]]]; 
			}
		}, 
		loaded: function(self, orders){
			self.db.all_orders_list = orders;

			self.db.get_orders_by_id = {};
			orders.forEach(function(order) {
				self.db.get_orders_by_id[order.id] = order;
			});
			self.orders = orders;
		},
	});
	
	models.load_models({
		model: 'pos.gift.coupon',
		fields: ['name', 'gift_coupen_code', 'user_id', 'issue_date', 'expiry_date', 'validity', 'total_available', 'partner_id', 'order_ids', 'active', 'amount', 'description','used','coupon_count', 'coupon_apply_times','expiry_date','partner_true','partner_id'],
		domain: null,
		loaded: function(self, pos_gift_coupon) {
			self.pos_gift_coupon = pos_gift_coupon;
		},
	});
	
	models.load_models({
		model: 'pos.coupons.setting',
		fields: ['name', 'product_id', 'min_coupan_value', 'max_coupan_value', 'max_exp_date', 'one_time_use', 'partially_use', 'default_name', 'default_validity', 'default_value', 'default_availability', 'active'],
		domain: null,
		loaded: function(self, pos_coupons_setting) {
			self.pos_coupons_setting = pos_coupons_setting;
		},
	});

	models.load_models({
		model: 'pos.order.line',
		fields: ['order_id', 'product_id', 'discount', 'qty', 'price_unit','discount_line_type'],
		domain: function(self) {
			var order_lines = []
			var orders = self.db.all_orders_list;
			for (var i = 0; i < orders.length; i++) {
				order_lines = order_lines.concat(orders[i]['lines']);
			}
			return [
				['id', 'in', order_lines]
			];
		},
		loaded: function(self, pos_order_line) {
			self.db.all_orders_line_list = pos_order_line;
			self.db.get_lines_by_id = {};
			pos_order_line.forEach(function(line) {
				self.db.get_lines_by_id[line.id] = line;
			});

			self.pos_order_line = pos_order_line;
		},
	});
	
	var SaleOrderButtonWidget = screens.ActionButtonWidget.extend({
		template: 'SaleOrderButtonWidget',

		button_click: function() {
			var self = this;
			this.gui.show_screen('see_all_sale_orders_screen_widget', {});
		},

	});

	screens.define_action_button({
		'name': 'See All Orders Button Widget',
		'widget': SaleOrderButtonWidget,
		'condition': function() {
			return true;
		},
	});

	// Load PosDB
	var PosDB=PosDB.extend({
			
		init: function(options){
			this.order_sorted = [];
			this.order_by_id = {};
			this.order_search_string = "";
			this.order_write_date = null;
			return PosDB.prototype.init.call(this, options);
		},
	
	
		get_orders_sorted: function(max_count){
			max_count = max_count ? Math.min(this.order_sorted.length, max_count) : this.order_sorted.length;
			var invoice = [];
			for (var i = 0; i < max_count; i++) {
				orders.push(this.order_by_id[this.order_sorted[i]]);
			}
			return orders;
		},
					
		get_product_write_date:function(products){
			return this.order_write_date || "1970-01-01 00:00:00";
		},
	});

	// Start POSBarcodeReturnWidget
	
	var POSBarcodeReturnWidget = screens.ActionButtonWidget.extend({
		template: 'POSBarcodeReturnWidget',

		button_click: function() {
			var self = this;
			//this.gui.show_screen('see_all_orders_screen_widget', {});
			this.gui.show_popup('pos_barcode_popup_widget', {});
		},
		
	});

	screens.define_action_button({
		'name': 'POS Return Order with Barcode',
		'widget': POSBarcodeReturnWidget,
		'condition': function() {
			return true;
		},
	});
	

	 // ReceiptScreenWidgetNew start
	 var ReceiptScreenWidgetNew = screens.ScreenWidget.extend({
	   template: 'ReceiptScreenWidgetNew',
		show: function() {
			var self = this;
			self._super();
			$('.button.back').on("click", function() {
				self.gui.show_screen('see_all_orders_screen_widget');
			});
			$('.button.print').click(function() {
				var test = self.chrome.screens.receipt;
				setTimeout(function() { self.chrome.screens.receipt.lock_screen(false); }, 1000);
				if (!test['_locked']) {
					self.chrome.screens.receipt.print_web();
					self.chrome.screens.receipt.lock_screen(true);
				}
			});
		}
	});
	gui.define_screen({ name: 'ReceiptScreenWidgetNew', widget: ReceiptScreenWidgetNew });


	
	// SeeAllOrdersScreenWidget start

	var SeeAllOrdersScreenWidget = screens.ScreenWidget.extend({
		template: 'SeeAllOrdersScreenWidget',
		init: function(parent, options) {
			this._super(parent, options);
			//this.options = {};
		},
		//
		
		line_selects: function(event,$line,id){
			var self = this;
			var orders = this.pos.db.get_orders_by_id[id];
			this.$('.client-list .lowlight').removeClass('lowlight');
			if ( $line.hasClass('highlight') ){
				$line.removeClass('highlight');
				$line.addClass('lowlight');
				this.display_orders_detail('hide',orders);
				//this.new_clients = null;
				//this.toggle_save_button();
			}else{
				this.$('.client-list .highlight').removeClass('highlight');
				$line.addClass('highlight');
				var y = event.pageY - $line.parent().offset().top;
				this.display_orders_detail('show',orders,y);
				//this.new_clients = orders;
				//this.toggle_save_button();
			}
			
		},
		
		toggle_save_button: function(){
			var $button = this.$('.button.next');
			if (this.editing_product) {
				$button.addClass('oe_hidden');
				return;
			} else if( this.new_invoice ){
				if( !this.old_product){
					$button.text(_t('Set Invoice'));
				}else{
					$button.text(_t('Change Invoice'));
				}
			}else{
				$button.text(_t('Deselect Invoice'));
			}
			//$button.toggleClass('oe_hidden',!this.has_product_changed());
		},
		
		reload_partners: function(){
			var self = this;
			return this.pos.load_new_orders().then(function(){
				self.render_list_orders(self.pos.db.get_partners_sorted(1000));
				
				// update the currently assigned client if it has been changed in db.
				var curr_client = self.pos.get_order().get_client();
				if (curr_client) {
					self.pos.get_order().set_client(self.pos.db.get_partner_by_id(curr_client.id));
				}
			});
		},
		
		display_orders_detail: function(visibility,order,clickpos){
			var self = this;
			var contents = this.$('.client-details-contents');
			var parent   = this.$('.orders-line ').parent();
			var scroll   = parent.scrollTop();
			var height   = contents.height();

			contents.off('click','.button.edit');
			contents.off('click','.button.save');
			contents.off('click','.button.undo');
			//contents.on('click','.button.edit',function(){ self.edit_client_details(partner); });
			contents.on('click','.button.save',function(){ self.save_client_details(order); });
			contents.on('click','.button.undo',function(){ self.undo_client_details(order); });

			this.editing_client = false;
			this.uploaded_picture = null;

			if(visibility === 'show'){
				contents.empty();
				
				//Custom Code for passing the orderlines
				var orderline = [];
				for (var z = 0; z < order.lines.length; z++){
					orderline.push(self.pos.db.get_lines_by_id[order.lines[z]])
				}
				//Custom code ends
				
				contents.append($(QWeb.render('OrderDetails',{widget:this,order:order,orderline:orderline})));

				var new_height   = contents.height();

				if(!this.details_visible){
					if(clickpos < scroll + new_height + 20 ){
						parent.scrollTop( clickpos - 20 );
					}else{
						parent.scrollTop(parent.scrollTop() + new_height);
					}
				}else{
					parent.scrollTop(parent.scrollTop() - height + new_height);
				}

				this.details_visible = true;
				//this.toggle_save_button();
			}
			
			
			else if (visibility === 'edit') {
			// Connect the keyboard to the edited field
			if (this.pos.config.iface_vkeyboard && this.chrome.widget.keyboard) {
				contents.off('click', '.detail');
				searchbox.off('click');
				contents.on('click', '.detail', function(ev){
					self.chrome.widget.keyboard.connect(ev.target);
					self.chrome.widget.keyboard.show();
				});
				searchbox.on('click', function() {
					self.chrome.widget.keyboard.connect($(this));
				});
			}

			this.editing_client = true;
			contents.empty();
			contents.append($(QWeb.render('ClientDetailsEdit',{widget:this})));
			//this.toggle_save_button();

			// Browsers attempt to scroll invisible input elements
			// into view (eg. when hidden behind keyboard). They don't
			// seem to take into account that some elements are not
			// scrollable.
			contents.find('input').blur(function() {
				setTimeout(function() {
					self.$('.window').scrollTop(0);
				}, 0);
			});

			contents.find('.image-uploader').on('change',function(event){
				self.load_image_file(event.target.files[0],function(res){
					if (res) {
						contents.find('.client-picture img, .client-picture .fa').remove();
						contents.find('.client-picture').append("<img src='"+res+"'>");
						contents.find('.detail.picture').remove();
						self.uploaded_picture = res;
					}
				});
			});
			} 
			
			
			else if (visibility === 'hide') {
				contents.empty();
				if( height > scroll ){
					contents.css({height:height+'px'});
					contents.animate({height:0},400,function(){
						contents.css({height:''});
					});
				}else{
					parent.scrollTop( parent.scrollTop() - height);
				}
				this.details_visible = false;
				//this.toggle_save_button();
			}
		},
		
		get_selected_partner: function() {
			var self = this;
			if (self.gui)
				return self.gui.get_current_screen_param('selected_partner_id');
			else
				return undefined;
		},
		
		render_list_orders: function(orders, search_input){
			var self = this;
			var selected_partner_id = this.get_selected_partner();
			var selected_client_orders = [];
			if (selected_partner_id != undefined) {
				for (var i = 0; i < orders.length; i++) {
					if (orders[i].partner_id[0] == selected_partner_id)
						selected_client_orders = selected_client_orders.concat(orders[i]);
				}
				orders = selected_client_orders;
			}
			
		   if (search_input != undefined && search_input != '') {
				var selected_search_orders = [];
				var search_text = search_input.toLowerCase()
				for (var i = 0; i < orders.length; i++) {
					if (orders[i].partner_id == '') {
						orders[i].partner_id = [0, '-'];
					}
					if(orders[i].partner_id[1] == false)
					{
						if (((orders[i].name.toLowerCase()).indexOf(search_text) != -1) || ((orders[i].pos_reference.toLowerCase()).indexOf(search_text) != -1)) {
						selected_search_orders = selected_search_orders.concat(orders[i]);
						}
					}
					else
					{
						if (((orders[i].name.toLowerCase()).indexOf(search_text) != -1) || ((orders[i].pos_reference.toLowerCase()).indexOf(search_text) != -1) || ((orders[i].partner_id[1].toLowerCase()).indexOf(search_text) != -1)) {
						selected_search_orders = selected_search_orders.concat(orders[i]);
						}
					}
				}
				orders = selected_search_orders;
			}
			
			
			var content = this.$el[0].querySelector('.orders-list-contents');
			content.innerHTML = "";
			var orders = orders;
			for(var i = 0, len = Math.min(orders.length,1000); i < len; i++){
				var order    = orders[i];
				var ordersline_html = QWeb.render('OrdersLine',{widget: this, order:orders[i], selected_partner_id: orders[i].partner_id[0]});
				var ordersline = document.createElement('tbody');
				ordersline.innerHTML = ordersline_html;
				ordersline = ordersline.childNodes[1];
				content.appendChild(ordersline);

			}
		},
		
		undo_client_details: function(partner) {
			this.display_orders_detail('hide');
			
		},
		
		saved_client_details: function(partner_id){
			var self = this;
			self.display_orders_detail('hide');
			alert('!! Customer Created Successfully !!')
			
		},
		
		//
		show: function(options) {
			var self = this;
			this._super(options);
			
			this.details_visible = false;
			
			var orders = self.pos.db.all_orders_list;
			var orders_lines = self.pos.db.all_orders_line_list;
			this.render_list_orders(orders, undefined);
			
			this.$('.back').click(function(){
				self.gui.show_screen('products');
			});
			
			//this code is for click on order line & that order will be appear 
			
			//################################################################################################################
			this.$('.orders-list-contents').delegate('.orders-line-name', 'click', function(event) {
			   
			   for(var ord = 0; ord < orders.length; ord++){
				   if (orders[ord]['id'] == $(this).data('id')){
					var orders1 = orders[ord];
				   }
			   }
			   //var orders1 = self.pos.db.get_orders_by_id[parseInt($(this).data('id'))];
				
			   var orderline = [];
			   for(var n=0; n < orders_lines.length; n++){
				   if (orders_lines[n]['order_id'][0] == $(this).data('id')){
					orderline.push(orders_lines[n])
				   }
			   }
				
				//Custom Code for passing the orderlines
				/*var orderline = [];
				for (var z = 0; z < orders1.lines.length; z++){
					orderline.push(self.pos.db.get_lines_by_id[orders1.lines[z]])
				}*/
				//Custom code ends
				
				self.gui.show_popup('see_order_details_popup_widget', {'order': [orders1], 'orderline':orderline});
			   
			   // self.line_selects(event, $(this), parseInt($(this).data('id')));
			});
			
			//################################################################################################################
			
			//################################################################################################################
			this.$('.orders-list-contents').delegate('.orders-line-ref', 'click', function(event) {
			   
			   
			   for(var ord = 0; ord < orders.length; ord++){
				   if (orders[ord]['id'] == $(this).data('id')){
					var orders1 = orders[ord];
				   }
			   }
			   //var orders1 = self.pos.db.get_orders_by_id[parseInt($(this).data('id'))];
				
				var orderline = [];
				for(var n=0; n < orders_lines.length; n++){
					if (orders_lines[n]['order_id'][0] == $(this).data('id')){
					 orderline.push(orders_lines[n])
					}
				}
				
				//Custom Code for passing the orderlines
				//var orderline = [];
				//for (var z = 0; z < orders1.lines.length; z++){
					//orderline.push(self.pos.db.get_lines_by_id[orders1.lines[z]])
				//}
				//Custom code ends
				
				self.gui.show_popup('see_order_details_popup_widget', {'order': [orders1], 'orderline':orderline});
			   
			   
			   // self.line_selects(event, $(this), parseInt($(this).data('id')));
			});
			
			//################################################################################################################
			
			//################################################################################################################
			this.$('.orders-list-contents').delegate('.orders-line-partner', 'click', function(event) {
			   
			   
			   for(var ord = 0; ord < orders.length; ord++){
				   if (orders[ord]['id'] == $(this).data('id')){
					var orders1 = orders[ord];
				   }
			   }
			   
			   //var orders1 = self.pos.db.get_orders_by_id[parseInt($(this).data('id'))];
				
				var orderline = [];
				for(var n=0; n < orders_lines.length; n++){
					if (orders_lines[n]['order_id'][0] == $(this).data('id')){
					 orderline.push(orders_lines[n])
					}
				}
				
				//Custom Code for passing the orderlines
				//var orderline = [];
				//for (var z = 0; z < orders1.lines.length; z++){
					//orderline.push(self.pos.db.get_lines_by_id[orders1.lines[z]])
				//}
				//Custom code ends
				
				self.gui.show_popup('see_order_details_popup_widget', {'order': [orders1], 'orderline':orderline});
			   
			   
			   // self.line_selects(event, $(this), parseInt($(this).data('id')));
			});
			
			//################################################################################################################
			
			//################################################################################################################
			this.$('.orders-list-contents').delegate('.orders-line-date', 'click', function(event) {
			   
			   for(var ord = 0; ord < orders.length; ord++){
				   if (orders[ord]['id'] == $(this).data('id')){
					var orders1 = orders[ord];
				   }
			   }
			   
			   //var orders1 = self.pos.db.get_orders_by_id[parseInt($(this).data('id'))];
				
				var orderline = [];
				for(var n=0; n < orders_lines.length; n++){
					if (orders_lines[n]['order_id'][0] == $(this).data('id')){
					 orderline.push(orders_lines[n])
					}
				}
				
				//Custom Code for passing the orderlines
				//var orderline = [];
				//for (var z = 0; z < orders1.lines.length; z++){
					//orderline.push(self.pos.db.get_lines_by_id[orders1.lines[z]])
				//}
				//Custom code ends
				
				self.gui.show_popup('see_order_details_popup_widget', {'order': [orders1], 'orderline':orderline});
			   
			   
			   // self.line_selects(event, $(this), parseInt($(this).data('id')));
			});
			
			//################################################################################################################
			
			//################################################################################################################
			this.$('.orders-list-contents').delegate('.orders-line-tot', 'click', function(event) {
			   
			   for(var ord = 0; ord < orders.length; ord++){
				   if (orders[ord]['id'] == $(this).data('id')){
					var orders1 = orders[ord];
				   }
			   }
			   
			   //var orders1 = self.pos.db.get_orders_by_id[parseInt($(this).data('id'))];
				
				var orderline = [];
				for(var n=0; n < orders_lines.length; n++){
					if (orders_lines[n]['order_id'][0] == $(this).data('id')){
					 orderline.push(orders_lines[n])
					}
				}
				
				
				//Custom Code for passing the orderlines
				//var orderline = [];
				//for (var z = 0; z < orders1.lines.length; z++){
					//orderline.push(self.pos.db.get_lines_by_id[orders1.lines[z]])
				//}
				//Custom code ends
				
				self.gui.show_popup('see_order_details_popup_widget', {'order': [orders1], 'orderline':orderline});
			   
			   
			   // self.line_selects(event, $(this), parseInt($(this).data('id')));
			});
			
			//################################################################################################################
			
			// Re Order
			this.$('.orders-list-contents').delegate('.re-order', 'click', function(result) {
				
				var order_id = parseInt(this.id);
				
				var selectedOrder = null;
				for(var i = 0, len = Math.min(orders.length,1000); i < len; i++) {
					if (orders[i] && orders[i].id == order_id) {
						selectedOrder = orders[i];
					}
				}
				
				var orderlines = [];
				var order_list = self.pos.db.all_orders_list;
				var order_line_data = self.pos.db.all_orders_line_list;

				selectedOrder.lines.forEach(function(line_id) {
					
					for(var y=0; y<order_line_data.length; y++){
						if(order_line_data[y]['id'] == line_id){
						   orderlines.push(order_line_data[y]); 
						}
					}
					
					//var line = self.pos.db.get_lines_by_id[line_id];
					//var product = self.pos.db.get_product_by_id(line.product_id[0]);
					//orderlines.push(line);
				});

				self.gui.show_popup('pos_re_order_popup_widget', { 'orderlines': orderlines, 'order': selectedOrder });
			});
			
			
			
			//Return Order
			this.$('.orders-list-contents').delegate('.return-order', 'click', function(result) {
				var order_id = parseInt(this.id);
				var selectedOrder = null;
				for(var i = 0, len = Math.min(orders.length,1000); i < len; i++) {
					if (orders[i] && orders[i].id == order_id) {
						selectedOrder = orders[i];
					}
				}
				
				var orderlines = [];
				var order_list = self.pos.db.all_orders_list;
				var order_line_data = self.pos.db.all_orders_line_list;
				
				selectedOrder.lines.forEach(function(line_id) {
					//var line = self.pos.db.get_lines_by_id[line_id];
					
					for(var y=0; y<order_line_data.length; y++){
						if(order_line_data[y]['id'] == line_id){
						   orderlines.push(order_line_data[y]); 
						}
					}
					
					
					//var product = self.pos.db.get_product_by_id(line.product_id[0]);
					//orderlines.push(line);
				});

				self.gui.show_popup('pos_return_order_popup_widget', { 'orderlines': orderlines, 'order': selectedOrder });
			});
			
			
			//Receipt Reprint
			this.$('.orders-list-contents').delegate('.print-order', 'click', function(result) {
				var order_id = parseInt(this.id);
				var orderlines = [];
				var paymentlines = [];
				var discount = 0;
				var subtotal = 0;
				var tax = 0;
				var discount_type = null;
				var i=0;
				var selectedOrder = null;
				for(var i = 0, len = Math.min(orders.length,1000); i < len; i++) {
					if (orders[i] && orders[i].id == order_id) {
						selectedOrder = orders[i];
					}
				}
				// console.log("selectedOrder-----------",selectedOrder);
				

			  (new Model('pos.order')).call('print_pos_receipt', [order_id]).fail(function(unused, event) {
					//alert('Connection Error. Try again later !!!!');
				}).done(function(output) {
					// console.log("qqqqqqqqqq================",output);
					for(i in output[0])
					{
						if(selectedOrder['discount_type'] == 'Percentage')
						{
							discount = discount + output[0][i]['price_unit']*(output[0][i]['discount']/100)*output[0][i]['qty']
							// console.log("oooo==",discount,"====",output[0][i]['discount'])
						}
						else
						{
							discount = discount+output[0][i]['discount']*output[0][i]['qty']
							// console.log("wwwwwwwwww==",discount,"====",output[0][i]['discount'])
						}
						
					}
					orderlines = output[0];
					paymentlines = output[2];
					// discount = output[1];
					subtotal = selectedOrder['amount_total'] - selectedOrder['amount_tax'] ;
					// console.log("xxxxxxxxxxxxxxxxx",subtotal)
					tax = selectedOrder['amount_tax'];
					self.gui.show_screen('ReceiptScreenWidgetNew');
					$('.pos-receipt-container').html(QWeb.render('PosTicket1',{
						widget:self,
						order: selectedOrder,
						paymentlines: paymentlines,
						orderlines: orderlines,
						discount_total: discount,
						change: output[3],
						subtotal: subtotal,
						tax: tax,
					}));
					// console.log("order=======================",orderlines)

				});
				
			});
			//End Receipt Reprint
			
			//this code is for Search Orders
			this.$('.search-order input').keyup(function() {
				self.render_list_orders(orders, this.value);
			});
			
			this.$('.new-customer').click(function(){
				self.display_orders_detail('edit',{
					'country_id': self.pos.company.country_id,
				});
			});
			
		},
		
		save_client_details: function(partner) {
			var self = this;
			
			var fields = {};
			this.$('.client-details-contents .detail').each(function(idx,el){
				fields[el.name] = el.value || false;
			});

			if (!fields.name) {
				this.gui.show_popup('error',_t('A Customer Name Is Required'));
				return;
			}
			
			if (this.uploaded_picture) {
				fields.image = this.uploaded_picture;
			}

			fields.id           = partner.id || false;
			fields.country_id   = fields.country_id || false;

			new Model('res.partner').call('create_from_ui',[fields]).then(function(partner_id){
				self.saved_client_details(partner_id);
			},function(err,event){
				event.preventDefault();
				self.gui.show_popup('error',{
					'title': _t('Error: Could not Save Changes'),
					'body': _t('Your Internet connection is probably down.'),
				});
			});
		},
		
		
		
		reload_orders: function(){
			var self = this;
			return this.pos.load_new_orders().then(function(){
				self.render_list_orders(self.pos.db.get_orders_sorted(1000));

			});
		},
		
		
		close: function(){
			this._super();
		},        

	});
	
	gui.define_screen({
		name: 'see_all_orders_screen_widget',
		widget: SeeAllOrdersScreenWidget
	});

	// End SeeAllOrdersScreenWidget
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	/*
	// SeeAllOrdersScreenWidget start

	var SeeAllOrdersScreenWidget = screens.ScreenWidget.extend({
		template: 'SeeAllOrdersScreenWidget',
		init: function(parent, options) {
			this._super(parent, options);
			//this.options = {};
		},
		//

		line_selects: function(event,$line,id){
			var self = this;
			var orders = this.pos.db.get_orders_by_id[id];
			this.$('.client-list .lowlight').removeClass('lowlight');
			if ( $line.hasClass('highlight') ){
				$line.removeClass('highlight');
				$line.addClass('lowlight');
				this.display_orders_detail('hide',orders);
				this.new_clients = null;
				//this.toggle_save_button();
			}else{
				this.$('.client-list .highlight').removeClass('highlight');
				$line.addClass('highlight');
				var y = event.pageY - $line.parent().offset().top;
				this.display_orders_detail('show',orders,y);
				this.new_clients = orders;
				//this.toggle_save_button();
			}

		},

		display_orders_detail: function(visibility,order,clickpos){
			var self = this;
			var contents = this.$('.client-details-contents');
			var parent   = this.$('.orders-line ').parent();
			var scroll   = parent.scrollTop();
			var height   = contents.height();

			contents.off('click','.button.edit');
			contents.off('click','.button.save');
			contents.off('click','.button.undo');

			this.editing_client = false;
			this.uploaded_picture = null;

			if(visibility === 'show'){
				contents.empty();
				contents.append($(QWeb.render('OrderDetails',{widget:this,order:order})));

				var new_height   = contents.height();

				if(!this.details_visible){
					if(clickpos < scroll + new_height + 20 ){
						parent.scrollTop( clickpos - 20 );
					}else{
						parent.scrollTop(parent.scrollTop() + new_height);
					}
				}else{
					parent.scrollTop(parent.scrollTop() - height + new_height);
				}

				this.details_visible = true;
				//this.toggle_save_button();
			} else if (visibility === 'hide') {
				contents.empty();
				if( height > scroll ){
					contents.css({height:height+'px'});
					contents.animate({height:0},400,function(){
						contents.css({height:''});
					});
				}else{
					parent.scrollTop( parent.scrollTop() - height);
				}
				this.details_visible = false;
				//this.toggle_save_button();
			}
		},

		get_selected_partner: function() {
			var self = this;
			if (self.gui)
				return self.gui.get_current_screen_param('selected_partner_id');
			else
				return undefined;
		},

		 render_list_orders: function(orders, search_input){
			var self = this;
			var selected_partner_id = this.get_selected_partner();
			var selected_client_orders = [];
			if (selected_partner_id != undefined) {
				for (var i = 0; i < orders.length; i++) {
					if (orders[i].partner_id[0] == selected_partner_id)
						selected_client_orders = selected_client_orders.concat(orders[i]);
				}
				orders = selected_client_orders;
			}
			
			if (search_input != undefined && search_input != '') {
				var selected_search_orders = [];
				var search_text = search_input.toLowerCase()
				for (var i = 0; i < orders.length; i++) {
					if (orders[i].partner_id == '') {
						orders[i].partner_id = [0, '-'];
					}
					if (((orders[i].name.toLowerCase()).indexOf(search_text) != -1) || ((orders[i].pos_reference.toLowerCase()).indexOf(search_text) != -1) || ((orders[i].partner_id[1].toLowerCase()).indexOf(search_text) != -1)) {
						selected_search_orders = selected_search_orders.concat(orders[i]);
					}
				}
				orders = selected_search_orders;
			}
			

			var content = this.$el[0].querySelector('.orders-list-contents');
			content.innerHTML = "";
			for(var i = 0, len = Math.min(orders.length,1000); i < len; i++){
				var order    = orders[i];
				var ordersline_html = QWeb.render('OrdersLine',{widget: this, order:orders[i], selected_partner_id: orders[i].partner_id[0]});
				var ordersline = document.createElement('tbody');
				ordersline.innerHTML = ordersline_html;
				ordersline = ordersline.childNodes[1];
				content.appendChild(ordersline);

			}
		},
		//
		show: function(options) {
			var self = this;
			this._super(options);

			this.details_visible = false;

			var orders = self.pos.db.all_orders_list;
			this.render_list_orders(orders, undefined);

			this.$('.back').click(function(){
				//self.gui.back();
				self.gui.show_screen('products');
			});
			
			//this code is for Search Orders
			this.$('.search-order input').keyup(function() {
				self.render_list_orders(orders, this.value);
			});
			
			
			//Return Order
			this.$('.orders-list-contents').delegate('.return-order', 'click', function(result) {
				var order_id = parseInt(this.id);
				var selectedOrder = null;
				for(var i = 0, len = Math.min(orders.length,1000); i < len; i++) {
					if (orders[i] && orders[i].id == order_id) {
						selectedOrder = orders[i];
					}
				}
				
				var orderlines = [];
				var order_list = self.pos.db.all_orders_list;
				var order_line_data = self.pos.db.all_orders_line_list;

				selectedOrder.lines.forEach(function(line_id) {
					var line = self.pos.db.get_lines_by_id[line_id];
					var product = self.pos.db.get_product_by_id(line.product_id[0]);
					orderlines.push(line);
				});

				self.gui.show_popup('pos_return_order_popup_widget', { 'orderlines': orderlines, 'order': selectedOrder });
			});
			//End Return Order
			
			

			//Re-Order
			this.$('.orders-list-contents').delegate('.re-order', 'click', function(result) {
				
				var order_id = parseInt(this.id);
				
				var selectedOrder = null;
				for(var i = 0, len = Math.min(orders.length,1000); i < len; i++) {
					if (orders[i] && orders[i].id == order_id) {
						selectedOrder = orders[i];
					}
				}
				
				var orderlines = [];
				var order_list = self.pos.db.all_orders_list;
				var order_line_data = self.pos.db.all_orders_line_list;

				selectedOrder.lines.forEach(function(line_id) {
					var line = self.pos.db.get_lines_by_id[line_id];
					var product = self.pos.db.get_product_by_id(line.product_id[0]);
					orderlines.push(line);
				});

				self.gui.show_popup('pos_re_order_popup_widget', { 'orderlines': orderlines, 'order': selectedOrder });
			});
			//End Re-Order
			
			//Receipt Reprint
			this.$('.orders-list-contents').delegate('.print-order', 'click', function(result) {
				var order_id = parseInt(this.id);
				var orderlines = [];
				var paymentlines = [];
				var discount = 0;

				var selectedOrder = null;
				for(var i = 0, len = Math.min(orders.length,1000); i < len; i++) {
					if (orders[i] && orders[i].id == order_id) {
						selectedOrder = orders[i];
					}
				}

			  (new Model('pos.order')).call('print_pos_receipt', [order_id]).fail(function(unused, event) {
					//alert('Connection Error. Try again later !!!!');
				}).done(function(output) {

					//var selectedOrder = self.pos.get('selectedOrder');

					orderlines = output[0];
					paymentlines = output[2];
					discount = output[1];
					self.gui.show_screen('ReceiptScreenWidgetNew');
					$('.pos-receipt-container').html(QWeb.render('PosTicket1',{
						widget:self,
						order: selectedOrder,
						paymentlines: paymentlines,
						orderlines: orderlines,
						discount_total: discount,
						change: output[3],
					}));


				});
				//End Receipt Reprint


			var contents = self.$('.orders-list-contents');
			contents.empty();
			var parent = self.$('.client-list').parent();
			parent.scrollTop(0);

		});

		},
		//


	});
	gui.define_screen({
		name: 'see_all_orders_screen_widget',
		widget: SeeAllOrdersScreenWidget
	});

	// End SeeAllOrdersScreenWidget */



	// PosReOrderPopupWidget Popup start

	var PosReOrderPopupWidget = popups.extend({
		template: 'PosReOrderPopupWidget',
		init: function(parent, args) {
			this._super(parent, args);
			this.options = {};
		},
		//
		show: function(options) {
			options = options || {};
			var self = this;
			this._super(options);
			this.orderlines = options.orderlines || [];

		},
		//
		renderElement: function() {
			var self = this;
			this._super();
			var selectedOrder = this.pos.get_order();
			var orderlines = self.options.orderlines;
			var order = self.options.order;

			// When you click on apply button, Customer is selected automatically in that order 
			var partner_id = false
			var client = false
			if (order && order.partner_id != null)
				partner_id = order.partner_id[0];
				client = this.pos.db.get_partner_by_id(partner_id);
				
			var reorder_products = {};

			this.$('#apply_reorder').click(function() {
				var entered_code = $("#entered_item_qty").val();
				var list_of_qty = $('.entered_item_qty');

				$.each(list_of_qty, function(index, value) {
					var entered_item_qty = $(value).find('input');
					var qty_id = parseFloat(entered_item_qty.attr('qty-id'));
					var line_id = parseFloat(entered_item_qty.attr('line-id'));
					var entered_qty = parseFloat(entered_item_qty.val());

					reorder_products[line_id] = entered_qty;
				});
				//return reorder_products;


				Object.keys(reorder_products).forEach(function(line_id) {
					
					var orders_lines = self.pos.db.all_orders_line_list;
					var orderline = [];
					   for(var n=0; n < orders_lines.length; n++){
						   if (orders_lines[n]['id'] == line_id){
							var product = self.pos.db.get_product_by_id(orders_lines[n].product_id[0]);
							selectedOrder.add_product(product, {
								quantity: parseFloat(reorder_products[line_id]),
								price: orders_lines[n].price_unit,
								discount: orders_lines[n].discount
							});
							selectedOrder.selected_orderline.original_line_id = orders_lines[n].id;
						   }
					   }
					
					
					//var line = self.pos.db.get_lines_by_id[line_id];
					//var product = self.pos.db.get_product_by_id(line.product_id[0]);
					/*selectedOrder.add_product(product, {
						quantity: parseFloat(reorder_products[line_id]),
						price: line.price_unit,
						discount: line.discount
					});
					selectedOrder.selected_orderline.original_line_id = line.id;*/
				});
				selectedOrder.set_client(client);
				self.pos.set_order(selectedOrder);
				self.gui.show_screen('products');

			   });


		},

	});
	gui.define_popup({
		name: 'pos_re_order_popup_widget',
		widget: PosReOrderPopupWidget
	});

	// End PosReOrderPopupWidget Popup start



	var PosBarcodePopupWidget = popups.extend({
		template: 'PosBarcodePopupWidget',
		init: function(parent, args) {
			this._super(parent, args);
			this.options = {};
		},
		
		show: function(options) {
			options = options || {};
			var self = this;
			this._super(options);

		},
		
		events: {
			'click .button.cancel': 'click_cancel',
		},
		
		
		/*display_return_order: function() {
			var self = this;
			var selectedOrder = this.pos.get_order();
			var orderlines = self.options.orderlines;
			var order = self.options.order;

			var return_products = {};
			var exact_return_qty = {};
			var exact_entered_qty = {};
			var orders = self.pos.db.all_orders_list;
			console.log('||||||||||||| orders |||||||||||||||||||', orders);
			
				
				var entered_barcode = $("#entered_item_barcode").val();
				
				var order_id = parseInt(this.id);
				var selectedOrder = null;
				for(var i = 0, len = Math.min(orders.length,1000); i < len; i++) {
					if (orders[i] && orders[i].barcode == entered_barcode) {
						selectedOrder = orders[i];
					}
					
				}
				if(selectedOrder){
					var orderlines = [];
					var order_list = self.pos.db.all_orders_list;
					var order_line_data = self.pos.db.all_orders_line_list;

					selectedOrder.lines.forEach(function(line_id) {
						var line = self.pos.db.get_lines_by_id[line_id];
						var product = self.pos.db.get_product_by_id(line.product_id[0]);
						orderlines.push(line);
					});
					self.pos.gui.show_popup('pos_return_order_popup_widget_return',{'orderlines': orderlines});
				}
				else{
					self.pos.gui.show_popup('error', {
						'title': _t('Invalid Barcode'),
						'body': _t("The Barcode You are Entering is Invalid"),
					});
				}
		
		},*/
		
		
		
		renderElement: function() {
			var self = this;
			this._super();
			var self = this;   
			var selectedOrder = this.pos.get_order();
			var orderlines = self.options.orderlines;
			var order = self.options.order;
			var return_products = {};
			var exact_return_qty = {};
			var exact_entered_qty = {};
			var orders = self.pos.db.all_orders_list;
			
			
			this.$('#apply_barcode_return_order').click(function() {
					
					var entered_barcode = $("#entered_item_barcode").val();
					
					var order_id = parseInt(this.id);
					var selectedOrder = null;
					for(var i = 0, len = Math.min(orders.length,1000); i < len; i++) {
						if (orders[i] && orders[i].barcode == entered_barcode) {
							selectedOrder = orders[i];
						}
						
					}
					if(selectedOrder){
						
						var orderlines = [];
						var order_list = self.pos.db.all_orders_list;
						var order_line_data = self.pos.db.all_orders_line_list;
						
						selectedOrder.lines.forEach(function(line_id) {
							//var line = self.pos.db.get_lines_by_id[line_id];
							
							for(var y=0; y<order_line_data.length; y++){
								if(order_line_data[y]['id'] == line_id){
								   orderlines.push(order_line_data[y]); 
								}
							}
						
						});

						self.gui.show_popup('pos_return_order_popup_widget', { 'orderlines': orderlines, 'order': selectedOrder });
						
						/*var orderlines = [];
						var order_list = self.pos.db.all_orders_list;
						var order_line_data = self.pos.db.all_orders_line_list;

						selectedOrder.lines.forEach(function(line_id) {
							var line = self.pos.db.get_lines_by_id[line_id];
							var product = self.pos.db.get_product_by_id(line.product_id[0]);
							orderlines.push(line);
						});
						self.pos.gui.show_popup('pos_return_order_popup_widget',{'orderlines': orderlines});*/
					}
					else{
						self.pos.gui.show_popup('error', {
							'title': _t('Invalid Barcode'),
							'body': _t("The Barcode You are Entering is Invalid"),
						});
					}
					
			});
			

		},

	});
	
	// PosReturnOrderPopupWidget Popup start

	var PosReturnOrderPopupWidget = popups.extend({
		template: 'PosReturnOrderPopupWidget',
		init: function(parent, args) {
			this._super(parent, args);
			this.options = {};
		},
		//
		show: function(options) {
			options = options || {};
			var self = this;
			this._super(options);
			this.orderlines = options.orderlines || [];

		},
		//
		renderElement: function() {
			var self = this;
			this._super();
			var selectedOrder = this.pos.get_order();
			var orderlines = self.options.orderlines;
			var order = self.options.order;

			// When you click on apply button, Customer is selected automatically in that order 
			var partner_id = false
			var client = false
			if (order && order.partner_id != null)
				partner_id = order.partner_id[0];
				client = this.pos.db.get_partner_by_id(partner_id);
				
			var return_products = {};

			var exact_return_qty = {};
			var exact_entered_qty = {};


			this.$('#apply_return_order').click(function() {
				var entered_code = $("#entered_item_qty").val();
				var list_of_qty = $('.entered_item_qty');
				$.each(list_of_qty, function(index, value) {
					var entered_item_qty = $(value).find('input');
					var qty_id = parseFloat(entered_item_qty.attr('qty-id'));
					var line_id = parseFloat(entered_item_qty.attr('line-id'));
					var entered_qty = parseFloat(entered_item_qty.val());
					
					exact_return_qty = qty_id;
					exact_entered_qty = entered_qty || 0;
					
					if(!exact_entered_qty){
						return;
					}
					else if (exact_return_qty >= exact_entered_qty){
					  return_products[line_id] = entered_qty;
					}
					else{
					alert("Cannot Return More quantity than purchased")
				}

				});
				
				Object.keys(return_products).forEach(function(line_id) {
					
					//##################### new code for sync with previous order #############################		
					
					var orders_lines = self.pos.db.all_orders_line_list;
					var orderline = [];
					   for(var n=0; n < orders_lines.length; n++){
						   if (orders_lines[n]['id'] == line_id){
							var product = self.pos.db.get_product_by_id(orders_lines[n].product_id[0]);
							selectedOrder.add_product(product, {
								quantity: - parseFloat(return_products[line_id]),
								price: orders_lines[n].price_unit,
								discount: orders_lines[n].discount
							});
							selectedOrder.selected_orderline.original_line_id = orders_lines[n].id;
						   }
					   }
					
					//#########################################################################################
					
					
					
					//var line = self.pos.db.get_lines_by_id[line_id];
					//var product = self.pos.db.get_product_by_id(line.product_id[0]);
					
					/*selectedOrder.add_product(product, {
						quantity: parseFloat(return_products[line_id]),
						price: - line.price_unit,
						discount: line.discount
					});
				
					selectedOrder.selected_orderline.original_line_id = line.id;*/
				});
				selectedOrder.set_client(client);
				self.pos.set_order(selectedOrder);
				self.gui.show_screen('products');

				//}
				
			

			   });
			   

		},

	});
	gui.define_popup({
		name: 'pos_return_order_popup_widget',
		widget: PosReturnOrderPopupWidget
	});

	gui.define_popup({
		name: 'pos_barcode_popup_widget',
		widget: PosBarcodePopupWidget
	});
	
	// End PosReturnOrderPopupWidget Popup start





	// Start SeeAllOrdersButtonWidget

	var SeeAllOrdersButtonWidget = screens.ActionButtonWidget.extend({
		template: 'SeeAllOrdersButtonWidget',

		button_click: function() {
			var self = this;
			this.gui.show_screen('see_all_orders_screen_widget', {});
		},

	});

	screens.define_action_button({
		'name': 'See All Orders Button Widget',
		'widget': SeeAllOrdersButtonWidget,
		'condition': function() {
			return true;
		},
	});
	// End SeeAllOrdersButtonWidget

// Start ClientListScreenWidget
		gui.Gui.prototype.screen_classes.filter(function(el) { return el.name == 'clientlist'})[0].widget.include({
			show: function(){
				this._super();
				var self = this;
				this.$('.view-orders').click(function(){
					self.gui.show_screen('see_all_orders_screen_widget', {});
				});


			$('.selected-client-orders').on("click", function() {
				self.gui.show_screen('see_all_orders_screen_widget', {
					'selected_partner_id': this.id
				});
			});

		},
	});
	
	//=================================================Order list popup=======================================
	
	
	var SeeOrderDetailsPopupWidget = popups.extend({
		template: 'SeeOrderDetailsPopupWidget',
		
		init: function(parent, args) {
			this._super(parent, args);
			this.options = {};
		},
		
		
		show: function(options) {
			var self = this;
			options = options || {};
			this._super(options);
			
			
			this.order = options.order || [];
			this.orderline = options.orderline || [];
			
			
		},
		
		events: {
			'click .button.cancel': 'click_cancel',
		},
		
		renderElement: function() {
			var self = this;
			this._super();
			
			
		},

	});

	
	
	gui.define_popup({
		name: 'see_order_details_popup_widget',
		widget: SeeOrderDetailsPopupWidget
	});
	
	//========================================================================================================


	// Start CreateSalesOrderButtonWidget
	
	var CreateSalesOrderButtonWidget = screens.ActionButtonWidget.extend({
		template: 'CreateSalesOrderButtonWidget',
		
		renderElement: function(){
			var self = this;
			this._super();
			//this.$el.click(function(){
		   //     self.button_click();
		 // });
		 
		  
		  //this.$('#create_sales_order').click(function() {
		  this.$el.click(function(){
				
				var order = self.pos.get('selectedOrder');

				var partner_id = false
				if (order.get_client() != null)
					partner_id = order.get_client();
				
				 // Popup Occurs when no Customer is selected...
					if (!partner_id) {
						self.gui.show_popup('error', {
							'title': _t('Unknown customer'),
							'body': _t('You cannot Create Sales Order. Select customer first.'),
						});
						return;
					}

				var orderlines = order.orderlines;
				
				// Popup Occurs when not a single product in orderline...
					if (orderlines.length === 0) {
						self.gui.show_popup('error', {
							'title': _t('Empty Order'),
							'body': _t('There must be at least one product in your order before Create Sales Order.'),
						});
						return;
					}
				
				var pos_product_list = [];
				for (var i = 0; i < orderlines.length; i++) {
					var product_items = {
						'id': orderlines.models[i].product.id,
						'quantity': orderlines.models[i].quantity,
						'uom_id': orderlines.models[i].product.uom_id[0],
						'price': orderlines.models[i].price
					};
					
					pos_product_list.push({'product': product_items });
				}
				

				(new Model('pos.create.sales.order')).call('create_sales_order', [partner_id ? partner_id.id : 0, partner_id ? partner_id.id : 0, pos_product_list]).fail(function(unused, event) {
					//alert('Connection Error. Try again later !!!!');
				}).done(function(output) {
					
					alert('Sales Order Created !!!!');	
					self.gui.show_screen('products');



				});
			});
			//self.button_click();
			
		},
			button_click: function(){},
			highlight: function(highlight){
			this.$el.toggleClass('highlight',!!highlight);
		},
		
		
		
	});

	screens.define_action_button({
		'name': 'Create Sales Order Button Widget',
		'widget': CreateSalesOrderButtonWidget,
		'condition': function() {
			return true;
		},
	});
	// End CreateSalesOrderButtonWidget	
	


	// Start pos_invoice_auto_check
	screens.PaymentScreenWidget.include({
		// Include auto_check_invoice boolean condition in watch_order_changes method
		watch_order_changes: function() {
			var self = this;
			var order = this.pos.get_order();
			
			if(this.pos.config.auto_check_invoice) // Condition True/False
				{
					var pos_order=this.pos.get_order();
					pos_order.set_to_invoice(true);
					this.$('.js_invoice').hide();
				}
			
			
			if (!order) {
				return;
			}
			if(this.old_order){
				this.old_order.unbind(null,null,this);
			}
			order.bind('all',function(){
				self.order_changes();
			});
			this.old_order = order;
		}
	
	});
	// End pos_invoice_auto_check	
	
	
		// Start PosBagWidget
	
	var PosBagWidget = screens.ActionButtonWidget.extend({
		template: 'PosBagWidget',
		
		renderElement: function(){
			var self = this;
			this._super();
			
			this.$el.click(function(){
				var selectedOrder = self.pos.get_order();
				var category = self.pos.config.pos_bag_category_id;
				var categ = self.pos.db.get_product_by_category(category[0])
				
				var products = self.pos.db.get_product_by_category(category[0])[0];
					
				//if (product.length == 1) {   
				if (self.pos.db.get_product_by_category(self.pos.config.pos_bag_category_id[0]).length == 1) { 
					selectedOrder.add_product(products);
					self.pos.set_order(selectedOrder);
					

					self.gui.show_screen('products');
				}else{
					var orderlines = self.pos.db.get_product_by_category(category[0]);
					self.gui.show_popup('pos_bag_popup_widget', {'orderlines': orderlines});
				}
				//self.gui.show_popup('pos_bag_popup_widget', {'orderlines': orderlines});

			});
		},
			button_click: function(){},
			highlight: function(highlight){
			this.$el.toggleClass('highlight',!!highlight);
		},
		
		
		
	});
	
	screens.define_action_button({
		'name': 'Pos Bag Widget',
		'widget': PosBagWidget,
		'condition': function() {
			return true;
		},
	});
	
	// PosBagPopupWidget Popup start

	var PosBagPopupWidget = popups.extend({
		template: 'PosBagPopupWidget',
		init: function(parent, args) {
			this._super(parent, args);
			this.options = {};
		},
		
		events: {
			'click .product.bag-category': 'click_on_bag_product',
			'click .button.cancel': 'click_cancel',
		},
		//
		
		get_product_image_url: function(product) {
			return window.location.origin + '/web/binary/image?model=product.product&field=image_medium&id=' + product.id;
		},
		show: function(options) {
			options = options || {};
			var self = this;
			this._super(options);
			this.orderlines = options.orderlines || [];
			var image_url = this.get_product_image_url(options);

	   

		},
		
		click_on_bag_product: function(event) {
			var self = this;
			var bag_id = parseInt($(event.target).parent().data('product-id'))
			//var bag_id = parseInt($(this).parent().data('id'));
			self.pos.get_order().add_product(self.pos.db.product_by_id[bag_id]);
			self.pos.gui.close_popup();
		},


	});
	
	gui.define_popup({
		name: 'pos_bag_popup_widget',
		widget: PosBagPopupWidget
	});

	// End Popup start
	
	var SelectExistingPopupWidget = popups.extend({
		template: 'SelectExistingPopupWidget',
		init: function(parent, args) {
			this._super(parent, args);
			this.options = {};
		},
		//
		show: function(options) {
			var self = this;
			this._super(options);

		},
		//
		renderElement: function() {
			var self = this;
			this._super();
			var order = this.pos.get_order();
			var selectedOrder = self.pos.get('selectedOrder');
			this.$('#apply_coupon_code').click(function() {
				var entered_code = $("#existing_coupon_code").val();
				var used = false;
				var coupon_applied = true;
				var partner_id = false
				if (order.get_client() != null)
					partner_id = order.get_client();
				(new Model('pos.gift.coupon')).call('existing_coupon', [partner_id ? partner_id.id : 0, entered_code]).fail(function(unused, event) {
				}).done(function(output) {
					var orderlines = order.orderlines;
					if (!partner_id) {
						self.gui.show_popup('error', {
							'title': _t('Unknown customer'),
							'body': _t('You cannot use Coupons/Gift Voucher. Select customer first.'),
						});
						return;
					}

					if (orderlines.length === 0) {
						self.gui.show_popup('error', {
							'title': _t('Empty Order'),
							'body': _t('There must be at least one product in your order before it can be apply for voucher code.'),
						});
						return;
					}


						if (orderlines.models.length) {
						if (output == 'true') {
							var selectedOrder = self.pos.get('selectedOrder');
							selectedOrder.coupon_id = entered_code;
							var total_amount = selectedOrder.get_total_without_tax();
							new Model('pos.gift.coupon').call('search_coupon', [partner_id ? partner_id.id : 0, entered_code]).fail(function(unused, event) {
							}).done(function(output) {
								order.coupon_id = output[0];
								var amount = output[1];
								used = output[2];
								var coupon_count = output[3];
								var coupon_times = output[4];
								var expiry = output[5]; 
								
								var current_date = new Date().toUTCString();
								//var n = date.datetime_to_str(new Date())
								var d = new Date();
								//var month = d.getMonth();
								var month = '' + (d.getMonth() + 1);
								var day = '' + d.getDate();
								var year = d.getFullYear();
								var date_format = [year, month, day].join('-');
								var hours = d.getHours();
								var minutes = d.getMinutes();
								var seconds = d.getSeconds();
								var time_format = [hours, minutes, seconds].join(':');
								var date_time = [date_format, time_format].join(' ');
								var partner_true = output[6];
								var gift_partner_id = output[7];
								var product_id = self.pos.pos_coupons_setting[0].product_id[0];
								
								for (var i = 0; i < orderlines.models.length; i++) {
									if (orderlines.models[i].product.id == product_id){
										coupon_applied = false;
										}
								}   
								
								if (coupon_applied == false) {
									self.gui.show_popup('error', {
										'title': _t('Coupon Already Applied'),
										'body': _t("The Coupon You are trying to apply is already applied in the OrderLines"),
									});
								}
								
								
								/*if (date_time > expiry){ // expired
									self.gui.show_popup('error', {
										'title': _t('Expired'),
										'body': _t("The Coupon You are trying to apply is Expired"),
									});
								}*/
								
								else if (coupon_count > coupon_times){ // maximum limit
									self.gui.show_popup('error', {
										'title': _t('Maximum Limit Exceeded !!!'),
										'body': _t("You already exceed the maximum number of limit for this Coupon code"),
									});
								}
								
								else if (partner_true == true && gift_partner_id != partner_id.id){
									//if(gift_partner_id != partner_id.id){
										self.gui.show_popup('error', {
											'title': _t('Invalid Customer !!!'),
											'body': _t("This Gift Coupon is not applicable for this Customer"),
										});
									//}
								}
							   
								else { // if coupon is not used
								
									var total_val = total_amount - amount;
									var product_id = self.pos.pos_coupons_setting[0].product_id[0];
									var product = self.pos.db.get_product_by_id(product_id);
									var selectedOrder = self.pos.get('selectedOrder');
									selectedOrder.add_product(product, {
										price: -amount
									});
							   }

							});
							self.gui.show_screen('products');
						} else { //Invalid Coupon Code
							self.gui.show_popup('error', {
								'title': _t('Invalid Code !!!'),
								'body': _t("Voucher Code Entered by you is Invalid. Enter Valid Code..."),
							});
						}

					} else { // Popup Shows, you can't use more than one Voucher Code in single order.
						self.gui.show_popup('error', {
							'title': _t('Already Used !!!'),
							'body': _t("You have already use this Coupon code, at a time you can use one coupon in a Single Order"),
						});
					}

				});
			});
		},

	});
	gui.define_popup({
		name: 'select_existing_popup_widget',
		widget: SelectExistingPopupWidget
	});

	// End Popup start

	var GiftButtonWidget = screens.ActionButtonWidget.extend({
		template: 'GiftButtonWidget',
		button_click: function() {
			var order = this.pos.get_order();
			var self = this;
			this.gui.show_popup('select_existing_popup_widget', {});
		},
	});

	screens.define_action_button({
		'name': 'POS Coupens Gift Voucher',
		'widget': GiftButtonWidget,
		'condition': function() {
			return true;
		},
	});


	// Total Items Count in exports.OrderWidget = Backbone.Model.extend ...
	var OrderWidgetExtended = screens.OrderWidget.include({

		update_summary: function(){
			var order = this.pos.get_order();
			if (!order.get_orderlines().length) {
				return;
			}

			var total     = order ? order.get_total_with_tax() : 0;
			var taxes     = order ? total - order.get_total_without_tax() : 0;
			var total_items    = order ? order.get_total_items() : 0;

			this.el.querySelector('.summary .total > .value').textContent = this.format_currency(total);
			this.el.querySelector('.summary .total .subentry .value').textContent = this.format_currency(taxes);
			this.el.querySelector('.items .value').textContent = total_items;

		},
	});
	/*
	//bi_pos_stock
	screens.ProductScreenWidget.include({
		show: function() {
			var self = this;
			this._super();
			
			if (self.pos.config.show_stock_location == 'specific')
			{
				var partner_id = this.pos.get_client();
				var location = self.pos.locations;

				if (self.pos.config.pos_stock_type == 'onhand')
				{		
					new Model("stock.quant").call('get_stock_location_qty', [partner_id ? partner_id.id : 0, location]).fail(function(unused, event) {
						//alert('Connection Error. Try again later !!!!');
					}).done(function(output) {
						   // console.log("output ttttttttttttttttttttttttttttttttttt",output)
						   var all = $('.product');
							$.each(all, function(index, value) {
								var product_id = $(value).data('product-id');
								for (var i = 0; i < output.length; i++) {
									var product = output[i][product_id];
									$(value).find('#stockqty').html(product);
								}
							});
					});
				}

				if (self.pos.config.pos_stock_type == 'available')
				{
					new Model("product.product").call('get_stock_location_avail_qty', [partner_id ? partner_id.id : 0, location]).fail(function(unused, event) {
					}).done(function(output) {
						   // console.log("output ttttttttttttttttttttttttttttttttttt",output)
						   var all = $('.product');
							$.each(all, function(index, value) {
								var product_id = $(value).data('product-id');
							
								for (var i = 0; i < output.length; i++) {
									var product = output[i][product_id];
									$(value).find('#availqty').html(product);
									// console.log("producttttttttttttttttttt",product_id,"ttttttttttttttttt",product)

								}
							});
					});
				}
			
			}
			
		},
	});
	
		
	screens.ProductListWidget.include({
		init: function(parent, options) {
			var self = this;
			this._super(parent,options);
			this.model = options.model;
			this.productwidgets = [];
			this.weight = options.weight || 0;
			this.show_scale = options.show_scale || false;
			this.next_screen = options.next_screen || false;

			this.click_product_handler = function(){
				var product = self.pos.db.get_product_by_id(this.dataset.productId);
				
				if(self.pos.config.show_stock_location == 'specific')
				{
					if (product.type == 'product')
					{

						var partner_id = self.pos.get_client();
						var location = self.pos.locations;

						new Model("stock.quant").call('get_single_product', [partner_id ? partner_id.id : 0,product.id, location]).fail(function(unused, event) {
						//alert('Connection Error. Try again later !!!!');
						}).done(function(output) {
								// console.log("outputtttttttttttttttttttttttt",output,self.pos.config.pos_deny_order)
								if (self.pos.config.pos_allow_order == false)
								{
									if (output[0][1] <= self.pos.config.pos_deny_order)
									{
										self.gui.show_popup('error',{
											'title': _t('Deny Order'),
											'body': _t("Deny Order" + "(" + product.display_name + ")" + " is Out of Stock.")
										});
									}
									else if (output[0][1] <= 0)
									{
										self.gui.show_popup('error',{
											'title': _t('Error: Out of Stock'),
											'body': _t("(" + product.display_name + ")" + " is Out of Stock."),
										});
									}
									else{
										options.click_product_action(product);
									}
								}
								else if(self.pos.config.pos_allow_order == true)
								{
									if (output[0][1] <= self.pos.config.pos_deny_order)
									{
										self.gui.show_popup('error',{
											'title': _t('Deny Order'),
											'body': _t("Deny Order" + "(" + product.display_name + ")" + " is Out of Stock.")
										});
									}
									else{
										options.click_product_action(product);
									}
								}
								else{
										options.click_product_action(product);		
								}

						});
					}else{
								options.click_product_action(product);
							}

				}
				
				else{

					if (product.type == 'product' && self.pos.config.pos_allow_order == false)
					{
					// Deny POS Order When Product is Out of Stock
						if (product.qty_available <= self.pos.config.pos_deny_order && self.pos.config.pos_allow_order == false)
						{
							self.gui.show_popup('error',{
								'title': _t('Deny Order'),
								'body': _t("Deny Order" + "(" + product.display_name + ")" + " is Out of Stock.")
							});
						}
						 
						
						// Allow POS Order When Product is Out of Stock
						else if (product.qty_available <= 0 && self.pos.config.pos_allow_order == false)
						{
							self.gui.show_popup('error',{
								'title': _t('Error: Out of Stock'),
								'body': _t("(" + product.display_name + ")" + " is Out of Stock."),
							});
						} else {
							options.click_product_action(product);
						}
					}
					else if(product.type == 'product' && self.pos.config.pos_allow_order == true && product.qty_available <= self.pos.config.pos_deny_order){
					self.gui.show_popup('error',{
							'title': _t('Error: Out of Stock'),
							'body': _t("(" + product.display_name + ")" + " is Out of Stock."),
						});
					}	
					else if(product.type == 'product' && self.pos.config.pos_allow_order == true && product.qty_available >= self.pos.config.pos_deny_order){
						options.click_product_action(product);
					} 
					else {
						options.click_product_action(product);
					}
				}
			};

		},
   
	});
	
	//bi_pos_stock
*/

	// Popup start

	var ValidQtyPopupWidget = popups.extend({
		template: 'ValidQtyPopupWidget',
		init: function(parent, args) {
			this._super(parent, args);
			this.options = {};
		},
		//
		show: function(options) {
			var self = this;
			this._super(options);
		},
		//
		renderElement: function() {
			var self = this;
			this._super();
			this.$('#back_to_products').click(function() {
				self.gui.show_screen('products');
			});            	
		},

	});
	gui.define_popup({
		name: 'valid_qty_popup_widget',
		widget: ValidQtyPopupWidget
	});

	// End Popup start
	
	// ActionpadWidget start
	screens.ActionpadWidget.include({
		renderElement: function() {
			var self = this;
			this._super();
			this.$('.pay').click(function(){
				var order = self.pos.get_order();

				var has_valid_product_lot = _.every(order.orderlines.models, function(line){
					return line.has_valid_product_lot();
				});
				if(!has_valid_product_lot){
					self.gui.show_popup('error',{
						'title': _t('Empty Serial/Lot Number'),
						'body':  _t('One or more product(s) required serial/lot number.'),
						confirm: function(){
							self.gui.show_screen('payment');
						},
					});
				}else{
					self.gui.show_screen('payment');
				}



			if (self.pos.config.show_stock_location == 'specific')
			{
				var partner_id = self.pos.get_client();
				var location = self.pos.locations;
				var lines = order.get_orderlines();
				
				(new Model('stock.quant')).call('get_stock_location_qty', [partner_id ? partner_id.id : 0, location]).fail(function(unused, event) {
				}).then(function(output) {

						var lines = order.get_orderlines();
						var flag = 0;

						for (var i = 0; i < lines.length; i++) {
							for (var j = 0; j < output.length; j++) {
								var values = $.map(output[0], function(value, key) { 
									var keys = $.map(output[0], function(value, key) {
										if (lines[i].product.type == 'product' && self.pos.config.pos_allow_order == false && lines[i].product['id'] == key && lines[i].quantity > value){
											flag = flag + 1;
										}
									});
																
								});
							}
						}
						if(flag > 0){
							self.gui.show_popup('valid_qty_popup_widget', {});
						}
						else{
							self.gui.show_screen('payment');
						}
				});
			
			} else {
			
				var lines = order.get_orderlines();

				for (var i = 0; i < lines.length; i++) {
					
					if (lines[i].product.type == 'product' && self.pos.config.pos_allow_order == false && lines[i].quantity > lines[i].product['qty_available']){
							self.gui.show_popup('valid_qty_popup_widget', {});
							break;
					}
					else { 
						 self.gui.show_screen('payment');   
						}
				}
				
				
			}

			});

			this.$('.set-customer').click(function(){
				self.gui.show_screen('clientlist');
			});
			
		},
	}); 
	// End ActionpadWidget start

	// SeeAllSaleOrdersScreenWidget start

	var SeeAllSaleOrdersScreenWidget = screens.ScreenWidget.extend({
		template: 'SeeAllSaleOrdersScreenWidget',
		init: function(parent, options) {
			this._super(parent, options);
			//this.options = {};
		},

		render_list_orders: function(orders, search_input){
			var self = this;            
			if(search_input != undefined && search_input != '') {
				var selected_search_orders = [];
				var search_text = search_input.toLowerCase()
				for (var i = 0; i < orders.length; i++) {
					if (orders[i].partner_id == '') {
						orders[i].partner_id = [0, '-'];
					}
					if (((orders[i].name.toLowerCase()).indexOf(search_text) != -1) || ((orders[i].name.toLowerCase()).indexOf(search_text) != -1) || ((orders[i].partner_id[1].toLowerCase()).indexOf(search_text) != -1)) {
						selected_search_orders = selected_search_orders.concat(orders[i]);
					}
				}
				orders = selected_search_orders;
			}
			
			
			var content = this.$el[0].querySelector('.client-list-contents');
			content.innerHTML = "";
			var orders = orders;
			for(var i = 0, len = Math.min(orders.length,1000); i < len; i++){
				var order    = orders[i];
				var ordersline_html = QWeb.render('SaleOrdersLine',{widget: this, order:orders[i]});
				var ordersline = document.createElement('tbody');
				ordersline.innerHTML = ordersline_html;
				ordersline = ordersline.childNodes[1];
				content.appendChild(ordersline);
			}
		},

		
		show: function(options) {
			var self = this;
			this._super(options);
			this.old_sale_order = null;
			this.details_visible = false;
			var flag = 0;
			var orders = self.pos.all_sale_orders_list;
			var orders_lines = self.pos.all_sale_orders_line_list;
			var selectedOrder;
			this.render_list_orders(orders, undefined);

			
			var selectedorderlines = [];
			var client = false
			
			this.$('.back').click(function(){
				self.gui.show_screen('products');
			});

			this.$('.client-list-contents').delegate('.sale-order','click',function(event){

				var order_id = parseInt(this.id);
				// console.log("id========================",order_id)
				selectedOrder = null;
				for(var i = 0, len = Math.min(orders.length,1000); i < len; i++) {
					if (orders[i] && orders[i].id == order_id) {
						selectedOrder = orders[i];
					}
				}
				var orderlines = [];
				var order_line_data = self.pos.db.all_orders_line_list;

				selectedOrder.order_line.forEach(function(line_id) {
					
					for(var y=0; y<orders_lines.length; y++){
						if(orders_lines[y]['id'] == line_id){
						   orderlines.push(orders_lines[y]); 
						}
					}
		
				});
				// console.log("line==========",orderlines);
				self.gui.show_popup('sale_order_popup_widget', { 'orderlines': orderlines, 'order': selectedOrder });
				
			});


			this.$('.client-list-contents').delegate('.orders-line-name', 'click', function(event) {
				var order_id = parseInt(this.id);
				// console.log("id========================",order_id)
				selectedOrder = null;
				for(var i = 0, len = Math.min(orders.length,1000); i < len; i++) {
					if (orders[i] && orders[i].id == order_id) {
						selectedOrder = orders[i];
					}
				}
				var orderlines = [];
			
				selectedOrder.order_line.forEach(function(line_id) {
					
					for(var y=0; y<orders_lines.length; y++){
						if(orders_lines[y]['id'] == line_id){
						   orderlines.push(orders_lines[y]); 
						}
					}
		
				});
				// console.log("line==========",orderlines);

				self.gui.show_popup('see_sale_order_details_popup_widget', {'orderline': orderlines, 'order': [selectedOrder] });
				
			});

			this.$('.client-list-contents').delegate('.orders-line-date', 'click', function(event) {
					var order_id = parseInt(this.id);
				// console.log("id========================",order_id)
				selectedOrder = null;
				for(var i = 0, len = Math.min(orders.length,1000); i < len; i++) {
					if (orders[i] && orders[i].id == order_id) {
						selectedOrder = orders[i];
					}
				}
				var orderlines = [];
				
				selectedOrder.order_line.forEach(function(line_id) {
					
					for(var y=0; y<orders_lines.length; y++){
						if(orders_lines[y]['id'] == line_id){
						   orderlines.push(orders_lines[y]); 
						}
					}
		
				});
				//console.log("line==========",orderlines);

				self.gui.show_popup('see_sale_order_details_popup_widget', {'orderline': orderlines, 'order': [selectedOrder] });
				
			});

			this.$('.client-list-contents').delegate('.orders-line-partner', 'click', function(event) {
				var order_id = parseInt(this.id);
				// console.log("id========================",order_id)
				selectedOrder = null;
				for(var i = 0, len = Math.min(orders.length,1000); i < len; i++) {
					if (orders[i] && orders[i].id == order_id) {
						selectedOrder = orders[i];
					}
				}
				var orderlines = [];
				
				selectedOrder.order_line.forEach(function(line_id) {
					
					for(var y=0; y<orders_lines.length; y++){
						if(orders_lines[y]['id'] == line_id){
						   orderlines.push(orders_lines[y]); 
						}
					}
		
				});
				// console.log("line==========",orderlines);

				self.gui.show_popup('see_sale_order_details_popup_widget', {'orderline': orderlines, 'order': [selectedOrder] });
				
			});

			this.$('.client-list-contents').delegate('.orders-line-saleperson', 'click', function(event) {
				var order_id = parseInt(this.id);
				// console.log("id========================",order_id)
				selectedOrder = null;
				for(var i = 0, len = Math.min(orders.length,1000); i < len; i++) {
					if (orders[i] && orders[i].id == order_id) {
						selectedOrder = orders[i];
					}
				}
				var orderlines = [];
				
				selectedOrder.order_line.forEach(function(line_id) {
					
					for(var y=0; y<orders_lines.length; y++){
						if(orders_lines[y]['id'] == line_id){
						   orderlines.push(orders_lines[y]); 
						}
					}
		
				});
				// console.log("line==========",orderlines);

				self.gui.show_popup('see_sale_order_details_popup_widget', {'orderline': orderlines, 'order': [selectedOrder] });
				
			});

			this.$('.client-list-contents').delegate('.orders-line-subtotal', 'click', function(event) {
				var order_id = parseInt(this.id);
				// console.log("id========================",order_id)
				selectedOrder = null;
				for(var i = 0, len = Math.min(orders.length,1000); i < len; i++) {
					if (orders[i] && orders[i].id == order_id) {
						selectedOrder = orders[i];
					}
				}
				var orderlines = [];
				
				selectedOrder.order_line.forEach(function(line_id) {
					
					for(var y=0; y<orders_lines.length; y++){
						if(orders_lines[y]['id'] == line_id){
						   orderlines.push(orders_lines[y]); 
						}
					}
		
				});
				// console.log("line==========",orderlines);

				self.gui.show_popup('see_sale_order_details_popup_widget', {'orderline': orderlines, 'order': [selectedOrder] });
				
			});
			
			this.$('.client-list-contents').delegate('.orders-line-tax', 'click', function(event) {
				var order_id = parseInt(this.id);
				// console.log("id========================",order_id)
				selectedOrder = null;
				for(var i = 0, len = Math.min(orders.length,1000); i < len; i++) {
					if (orders[i] && orders[i].id == order_id) {
						selectedOrder = orders[i];
					}
				}
				var orderlines = [];
				
				selectedOrder.order_line.forEach(function(line_id) {
					
					for(var y=0; y<orders_lines.length; y++){
						if(orders_lines[y]['id'] == line_id){
						   orderlines.push(orders_lines[y]); 
						}
					}
		
				});
				// console.log("line==========",orderlines);

				self.gui.show_popup('see_sale_order_details_popup_widget', {'orderline': orderlines, 'order': [selectedOrder] });
				
			});

			this.$('.client-list-contents').delegate('.orders-line-tot', 'click', function(event) {
				var order_id = parseInt(this.id);
				// console.log("id========================",order_id)
				selectedOrder = null;
				for(var i = 0, len = Math.min(orders.length,1000); i < len; i++) {
					if (orders[i] && orders[i].id == order_id) {
						selectedOrder = orders[i];
					}
				}
				var orderlines = [];
				
				selectedOrder.order_line.forEach(function(line_id) {
					
					for(var y=0; y<orders_lines.length; y++){
						if(orders_lines[y]['id'] == line_id){
						   orderlines.push(orders_lines[y]); 
						}
					}
		
				});
				// console.log("line==========",orderlines);

				self.gui.show_popup('see_sale_order_details_popup_widget', {'orderline': orderlines, 'order': [selectedOrder] });
				
			});




			//this code is for Search Orders
			this.$('.search-order input').keyup(function() {
				self.render_list_orders(orders, this.value);
			});
			
		},     

	});
	gui.define_screen({
		name: 'see_all_sale_orders_screen_widget',
		widget: SeeAllSaleOrdersScreenWidget
	});

	var SaleOrderPopupWidget = popups.extend({
		template: 'SaleOrderPopupWidget',
		init: function(parent, args) {
			this._super(parent, args);
			this.options = {};
		},
		//
		show: function(options) {
			options = options || {};
			var self = this;
			this._super(options);
			this.orderlines = options.orderlines || [];

		},
		//
		renderElement: function() {
			var self = this;
			this._super();
			var selectedOrder = this.pos.get_order();
			var orderlines = self.options.orderlines;
			var order = self.options.order;
			// console.log("order===============",order,"orderline==========",orderlines)
			// When you click on apply button, Customer is selected automatically in that order 
			var partner_id = false
			var client = false
			if (order && order.partner_id != null)
				partner_id = order.partner_id[0];
				client = this.pos.db.get_partner_by_id(partner_id);
				
			var reorder_products = {};

			this.$('#apply_saleorder').click(function() {
				var entered_code = $("#entered_item_qty").val();
				var list_of_qty = $('.entered_item_qty');

				$.each(list_of_qty, function(index,value) {
					var entered_item_qty = $(value).find('input');
					var qty_id = parseFloat(entered_item_qty.attr('qty-id'));
					var line_id = parseFloat(entered_item_qty.attr('line-id'));
					var entered_qty = parseFloat(entered_item_qty.val());

					reorder_products[line_id] = entered_qty;
					// console.log("====1111===",entered_qty,"========","=====",qty_id,"====",line_id)
				});

				for(var i in reorder_products)
				{   
					// console.log("Raghavvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv",i,":",reorder_products[i])
					var orders_lines = self.pos.all_sale_orders_line_list;
					for(var n=0; n < orders_lines.length; n++)
					{
					   if (orders_lines[n]['id'] == i)
					   {
							var product = self.pos.db.get_product_by_id(orders_lines[n].product_id[0]);
							// console.log("product=============",product)
							if(product)
							{
								selectedOrder.add_product(product, {
									quantity: parseFloat(reorder_products[i]),
									price: orders_lines[n].price_unit,
									discount: orders_lines[n].discount
								});
								selectedOrder.selected_orderline.original_line_id = orders_lines[n].id;
								selectedOrder.set_client(client);
								self.pos.set_order(selectedOrder);
							}
							else{
								alert("please configure product for point of sale.");
								return;
							}
					   }
					}
				}
					
				self.gui.show_screen('products');

			   });
		},

	});

	gui.define_popup({
		name: 'sale_order_popup_widget',
		widget: SaleOrderPopupWidget
	});

	var SeeSaleOrderDetailsPopupWidget = popups.extend({
		template: 'SeeSaleOrderDetailsPopupWidget',
		
		init: function(parent, args) {
			this._super(parent, args);
			this.options = {};
		},
		
		show: function(options) {
			var self = this;
			options = options || {};
			this._super(options);
			
			
			this.order = options.order || [];
			this.orderline = options.orderline || [];
			
			// console.log('ssssssssssshhhhhhhhhhhhooooooooooooooooooowwwwwwwwwwwwwwww', this.order, this.orderline)
			
		},
		
		events: {
			'click .button.cancel': 'click_cancel',
		},

		renderElement: function() {
			var self = this;
			this._super();  
		},
	});

	gui.define_popup({
		name: 'see_sale_order_details_popup_widget',
		widget: SeeSaleOrderDetailsPopupWidget
	});
		   

});
